import { randomUUID } from "expo-crypto";
import { router } from "expo-router";
import { useState, type ReactNode } from "react";
import { Text, View } from "react-native";

import { useAccount } from "@/features/account/account";
import { CONDITIONS } from "@/features/listings/types";
import { errorField, errorMessage } from "@/lib/errors";
import type { UploadedPhoto } from "@/lib/media";
import { Button } from "@/ui/Button";
import { Chip } from "@/ui/Chip";
import { ListingCard, type ListingCardData } from "@/ui/ListingCard";

import { postListing, type Draft } from "./postListing";

export const COURSE_CODE = /^[A-Z]{2,5} ?[0-9]{2,4}[A-Z]?$/;

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View className="gap-3 pt-2">
      <Text accessibilityRole="header" className="text-lg font-extrabold text-ink">
        {title}
      </Text>
      {children}
    </View>
  );
}

export function FieldError({ text }: { text: string | false | null | undefined }) {
  return text ? <Text className="text-sm text-danger">{text}</Text> : null;
}

export function ConditionChips({
  value,
  onChange,
  error,
}: {
  value: string | null;
  onChange: (value: string) => void;
  error?: string | null;
}) {
  return (
    <View className="gap-1.5">
      <Text className="text-sm font-bold text-ink">Condition</Text>
      <View className="flex-row flex-wrap gap-2">
        {CONDITIONS.map(([id, label]) => (
          <Chip key={id} label={label} selected={value === id} onPress={() => onChange(id)} />
        ))}
      </View>
      {error ? <Text className="text-sm text-danger">{error}</Text> : null}
    </View>
  );
}

// "Card as buyers will see it" (spec 3.3, Preview and post).
export function Preview({ card }: { card: Omit<ListingCardData, "areaLabel"> }) {
  const { account } = useAccount();
  const area = account?.campus ? (account.campus.short_name ?? account.campus.name) : "Your area";
  return (
    <Section title="Preview">
      <View className="rounded-2xl border border-line px-3">
        <ListingCard card={{ ...card, areaLabel: area }} />
      </View>
    </Section>
  );
}

// Posting state shared by the three sell screens: one request id and one upload cache per screen, so a
// retry after a failure neither double-posts nor re-uploads.
export function usePost() {
  const { session } = useAccount();
  const [requestId] = useState(() => randomUUID());
  const [uploaded] = useState(() => new Map<string, UploadedPhoto>());
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<{ text: string; field: string | null } | null>(null);

  const post = async (draft: Draft) => {
    if (!session) return;
    setError(null);
    setStatus("Preparing…");
    try {
      const listing = await postListing(session.user.id, draft, requestId, uploaded, (done, total) =>
        setStatus(done < total ? `Uploading photos ${done + 1} of ${total}…` : "Posting…"),
      );
      setStatus(null);
      // The new listing replaces the editor, so Back from it returns to where Sell was opened.
      router.replace({ pathname: "/listing/[id]", params: { id: listing.id } });
    } catch (e) {
      setStatus(null);
      setError({ text: errorMessage(e), field: errorField(e) });
    }
  };

  return { post, status, busy: status !== null, error };
}

// The footer of every sell screen: the server's message for errors it does not tie to a field shown
// on screen, then progress or the Post button.
export function PostFooter({
  status,
  error,
  onPost,
  label = "Post",
}: {
  status: string | null;
  error: string | null;
  onPost: () => void;
  label?: string;
}) {
  return (
    <>
      {error ? (
        <Text accessibilityLiveRegion="polite" className="text-center text-sm text-danger">
          {error}
        </Text>
      ) : null}
      <Button label={status ?? label} onPress={onPost} disabled={status !== null} />
    </>
  );
}
