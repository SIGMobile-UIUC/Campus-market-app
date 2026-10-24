-- DB-10: the trades-advance job, every 5 minutes: proposal expiry after 48 hours, auto-complete 72 hours
-- after the meetup when one side confirmed, expiry 7 days after it when nobody did (spec 4.10.5, 4.19, 5.2).
-- Dispute deadlines join this job with DB-14.

create extension if not exists pg_cron with schema pg_catalog;

-- Returns how many due trades it handled. User actions use the same conditional updates and the
-- same row lock, so a confirmation and the job cannot both complete a trade.
create function private.trades_advance() returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_trade public.trades;
  v_count int := 0;
begin
  -- One run at a time (4.19); the lock is released at commit.
  if not pg_try_advisory_xact_lock(hashtext('trades-advance')) then
    return 0;
  end if;

  -- ponytail: 500 per run is 6,000 an hour; loop within the run if that is ever short.
  for v_trade in
    select * from public.trades
    where status in ('proposed', 'accepted') and next_check_at <= now()
    order by next_check_at
    limit 500
    for update skip locked
  loop
    -- One bad row must not hold back the rest; it stays due and warns on every run.
    begin
      if v_trade.status = 'proposed' then
        update public.trades set status = 'expired', closed_at = now(), next_check_at = null where id = v_trade.id;
        perform private.trade_event(v_trade.id, null);
      elsif now() >= v_trade.meet_at + interval '72 hours'
            and exists (select 1 from public.trade_confirmations where trade_id = v_trade.id) then
        perform private.complete_trade(v_trade.id, null);
      elsif now() >= v_trade.meet_at + interval '7 days' then
        update public.items set status = 'available', reserved_trade_id = null where reserved_trade_id = v_trade.id;
        update public.trades set status = 'expired', closed_at = now(), next_check_at = null where id = v_trade.id;
        perform private.trade_event(v_trade.id, null);
      else
        update public.trades set next_check_at = private.next_check(v_trade.id) where id = v_trade.id;
      end if;
      v_count := v_count + 1;
    exception when others then
      raise warning 'trades-advance: trade % failed: %', v_trade.id, sqlerrm;
    end;
  end loop;
  return v_count;
end;
$$;

revoke execute on function private.trades_advance() from public, anon, authenticated;

select cron.schedule('trades-advance', '*/5 * * * *', 'select private.trades_advance()');
