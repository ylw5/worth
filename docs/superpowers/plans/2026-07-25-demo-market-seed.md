# Demo Market Seed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为生产环境当前 4 个在用物品写入最近 7 天演示估值，使详情页展示今日估值和趋势曲线。

**Architecture:** 通过一个 PostgreSQL 事务生成任务和快照，再同步物品最新估值字段。所有演示快照使用 `demo_seed` 来源；唯一键保证重复执行是幂等的。

**Tech Stack:** PostgreSQL、Supabase、psycopg 3

## Global Constraints

- 日期固定覆盖 2026-07-19 至 2026-07-25。
- 基准价固定为：可折叠墨镜 ¥299、讯飞 AI 会议耳机 ¥792.50、无醇双柚风味拉格 ¥12、骨传导耳机 ¥299。
- 不修改已售物品，不打印数据库密钥。
- 任一步失败时回滚整个事务。
- 不修改用户当前未提交的愿望清单文件。

---

### Task 1: 写入并验证演示行情

**Files:**
- Create: none
- Modify: none
- Test: production database read-back queries

**Interfaces:**
- Consumes: `assets`、`analysis_runs`、`market_snapshots`
- Produces: 每个在用物品 7 条 `source = 'demo_seed'` 快照，以及与 2026-07-25 快照一致的物品最新估值

- [ ] **Step 1: 确认写入前状态**

运行只读查询，预期当前有 4 个未售物品且演示快照为 0：

```sql
select count(*) from assets where status <> 'sold';
select count(*) from market_snapshots where source = 'demo_seed';
```

- [ ] **Step 2: 在单个事务中执行幂等写入**

使用以下确定性波动系数：

```text
2026-07-19 1.040
2026-07-20 1.025
2026-07-21 1.030
2026-07-22 1.015
2026-07-23 1.020
2026-07-24 1.010
2026-07-25 1.000
```

对当前 4 个物品按名称匹配基准价，upsert 每日成功任务和快照。估值四舍五入到分，最低价为估值的 90%，最高价为估值的 110%，`sample_count = 12`、`samples = []`、`source = 'demo_seed'`。随后把每个物品的最新估值字段同步为 2026-07-25 快照。

- [ ] **Step 3: 验证数据库结果**

运行：

```sql
select asset_id, count(*), min(snapshot_date), max(snapshot_date)
from market_snapshots
where source = 'demo_seed'
group by asset_id;
```

预期每个物品均返回 `7, 2026-07-19, 2026-07-25`。

运行：

```sql
select a.name, a.latest_market_price, s.estimated_price, r.status
from assets a
join market_snapshots s
  on s.asset_id = a.id and s.snapshot_date = date '2026-07-25'
join analysis_runs r on r.id = s.run_id
where a.status <> 'sold';
```

预期 4 行，`latest_market_price = estimated_price` 且 `status = 'succeeded'`。

- [ ] **Step 4: 验证前端读取形状**

按详情页现有查询顺序读取每个物品快照：

```sql
select asset_id, snapshot_date, estimated_price, price_low, price_high,
       sample_count, query, source, created_at
from market_snapshots
where source = 'demo_seed'
order by asset_id, snapshot_date;
```

预期 28 行，字段满足 `MarketSnapshot` 所需形状，且每个物品最后一行日期为 2026-07-25。
