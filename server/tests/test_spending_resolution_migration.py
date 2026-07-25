from pathlib import Path


def test_confirmed_resolution_updates_purchase_memory_source() -> None:
    migration = (
        Path(__file__).parents[2]
        / "supabase/migrations/202607250007_spending_resolution_memory.sql"
    ).read_text()

    assert "perform public.record_purchase_outcome(" in migration
    assert "'skip'," in migration
    assert "'not_bought'," in migration
    assert "resolution.confirmed_at is not null" in migration
