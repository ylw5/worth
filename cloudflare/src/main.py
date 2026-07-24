from workers import Response, WorkerEntrypoint, WorkflowEntrypoint

from .supabase import Supabase


def database(env):
    return Supabase(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)


class Default(WorkerEntrypoint):
    async def fetch(self, request):
        return Response.json({"status": "ok"})

    async def scheduled(self, controller, env, ctx):
        if controller.cron == "0 19 * * 0":
            runs = await database(env).rpc("enqueue_weekly_forecast_runs")
            workflow = env.FORECAST_WORKFLOW
        else:
            runs = await database(env).rpc("enqueue_daily_market_runs")
            workflow = env.MARKET_WORKFLOW
        for run in runs:
            await workflow.create(
                {"id": run["id"], "params": {"run_id": run["id"]}}
            )


class MarketWorkflow(WorkflowEntrypoint):
    async def run(self, event, step):
        run_id = event["payload"]["run_id"]
        db = database(self.env)

        @step.do("claim")
        async def claim():
            return await db.rpc(
                "claim_analysis_run",
                {"p_run_id": run_id},
            )

        @step.do("load asset")
        async def load_asset(claim):
            if not claim:
                return None
            return await db.asset(claim["asset_id"])

        @step.do(
            "collect and filter",
            config={
                "retries": {
                    "limit": 2,
                    "delay": "5 seconds",
                    "backoff": "exponential",
                },
                "timeout": "2 minutes",
            },
        )
        async def collect_and_filter(load_asset):
            if not load_asset:
                return None
            from .filter import collect_market_result

            result = await collect_market_result(self.env, load_asset)
            return result.model_dump(mode="json")

        @step.do("save snapshot")
        async def save_snapshot(collect_and_filter):
            if not collect_and_filter:
                return {"status": "skipped"}
            await db.rpc(
                "complete_market_run",
                {
                    "p_run_id": run_id,
                    "p_result": collect_and_filter,
                },
            )
            return {"status": "succeeded"}

        try:
            await claim()
            await load_asset()
            await collect_and_filter()
            return await save_snapshot()
        except Exception as error:
            await db.rpc(
                "fail_analysis_run",
                {"p_run_id": run_id, "p_message": str(error)},
            )
            raise


class ForecastWorkflow(WorkflowEntrypoint):
    async def run(self, event, step):
        run_id = event["payload"]["run_id"]
        db = database(self.env)

        @step.do("claim")
        async def claim():
            return await db.rpc(
                "claim_analysis_run",
                {"p_run_id": run_id},
            )

        @step.do("load asset")
        async def load_asset(claim):
            if not claim:
                return None
            return await db.asset(claim["asset_id"])

        @step.do("load snapshots")
        async def load_snapshots(claim):
            if not claim:
                return []
            return await db.rows(
                "market_snapshots",
                {
                    "asset_id": f"eq.{claim['asset_id']}",
                    "select": "snapshot_date,estimated_price",
                    "order": "snapshot_date.asc",
                    "limit": "180",
                },
            )

        @step.do(
            "bocha research",
            config={
                "retries": {
                    "limit": 2,
                    "delay": "10 seconds",
                    "backoff": "exponential",
                },
                "timeout": "3 minutes",
            },
        )
        async def research_step(load_asset):
            if not load_asset:
                return None
            from .research import research

            profile, evidence = await research(self.env, load_asset)
            return {
                "profile": profile.model_dump(mode="json"),
                "evidence": [
                    item.model_dump(mode="json") for item in evidence
                ],
            }

        @step.do("calculate forecast")
        async def calculate_forecast(
            load_asset,
            load_snapshots,
            research_step,
        ):
            if not load_asset or not research_step:
                return None
            from .forecast import forecast
            from .models import Evidence, ValuationProfile

            profile = ValuationProfile.model_validate(
                research_step["profile"]
            )
            evidence = [
                Evidence.model_validate(item)
                for item in research_step["evidence"]
            ]
            result = forecast(
                float(load_asset["latest_market_price"]),
                load_snapshots,
                evidence,
                profile,
                evidence,
            )
            return result.model_dump(mode="json")

        @step.do("save forecast")
        async def save_forecast(calculate_forecast):
            if not calculate_forecast:
                return {"status": "skipped"}
            await db.rpc(
                "complete_forecast_run",
                {
                    "p_run_id": run_id,
                    "p_result": calculate_forecast,
                },
            )
            return {
                "status": "succeeded",
                "method": calculate_forecast["method"],
            }

        try:
            await claim()
            await load_asset()
            await load_snapshots()
            await research_step()
            await calculate_forecast()
            return await save_forecast()
        except Exception as error:
            await db.rpc(
                "fail_analysis_run",
                {"p_run_id": run_id, "p_message": str(error)},
            )
            raise
