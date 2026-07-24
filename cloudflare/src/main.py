from workers import Response, WorkerEntrypoint, WorkflowEntrypoint

from supabase import Supabase


def database(env):
    return Supabase(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)


class Default(WorkerEntrypoint):
    async def fetch(self, request):
        return Response.json({"status": "ok"})

    async def scheduled(self, controller, env, ctx):
        runs = await database(env).rpc("enqueue_daily_market_runs")
        for run in runs:
            await env.MARKET_WORKFLOW.create(
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
            from filter import collect_market_result

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
