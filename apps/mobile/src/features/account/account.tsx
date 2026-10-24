import type { Session } from "@supabase/supabase-js";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

import type { Loadout } from "@/features/avatar/Avatar";
import type { CampusRow } from "@/features/campus/campuses";
import { supabase } from "@/lib/supabase";

// get_my_account (spec 6.3).
export type Account = {
  email: string;
  campus: CampusRow | null;
  display_name: string | null;
  tier: string;
  status: "active" | "suspended" | "banned" | "deleted";
  onboarded: boolean;
  avatar: Loadout;
  created_at: string;
};

type AccountState = {
  loading: boolean;
  session: Session | null;
  account: Account | null;
  // True when signed in but the account could not be loaded, e.g. offline.
  failed: boolean;
  refresh: () => Promise<void>;
};

const AccountContext = createContext<AccountState | null>(null);

export function useAccount() {
  const state = useContext(AccountContext);
  if (!state) throw new Error("useAccount must be used inside AccountProvider");
  return state;
}

export function AccountProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [account, setAccount] = useState<Account | null>(null);
  const [failed, setFailed] = useState(false);
  // Only the latest load may write, so a slow reply for a previous session cannot outlive a sign-out.
  const latest = useRef(0);

  const load = useCallback(async (current: Session | null) => {
    const request = ++latest.current;
    if (!current) {
      setAccount(null);
      setFailed(false);
      return;
    }
    const { data, error } = await supabase.rpc("get_my_account");
    if (request !== latest.current) return;
    // A session without a usable profile (deleted account) is signed out.
    if (error?.message === "AUTH_REQUIRED") {
      await supabase.auth.signOut({ scope: "local" });
      return;
    }
    setAccount(error ? null : (data as Account));
    setFailed(!!error);
  }, []);

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event, next) => {
      setSession(next);
      if (event === "TOKEN_REFRESHED") return;
      void load(next).finally(() => setLoading(false));
    });
    return () => data.subscription.unsubscribe();
  }, [load]);

  const refresh = useCallback(() => load(session), [load, session]);

  return (
    <AccountContext.Provider value={{ loading, session, account, failed, refresh }}>
      {children}
    </AccountContext.Provider>
  );
}
