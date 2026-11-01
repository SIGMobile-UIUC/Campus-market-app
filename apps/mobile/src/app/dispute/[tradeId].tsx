import { Image } from "expo-image";
import { useFocusEffect, useLocalSearchParams } from "expo-router";
import { Camera } from "lucide-react-native";
import { useCallback, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from "react-native";

import { useAccount } from "@/features/account/account";
import { fetchTrades, type Trade } from "@/features/trades/api";
import {
  canClaimNow,
  DISPUTE_MESSAGES,
  DISPUTE_STATUS,
  fetchDisputes,
  responseDue,
  type Dispute,
  type Evidence,
} from "@/features/trades/disputes";
import { errorMessage } from "@/lib/errors";
import { pickPhotos, uploadEvidencePhoto } from "@/lib/media";
import { supabase } from "@/lib/supabase";
import { Button } from "@/ui/Button";
import { Field } from "@/ui/Field";
import { Header } from "@/ui/Header";
import { Photo } from "@/ui/Photo";
import { TextLink } from "@/ui/TextLink";
import { toast } from "@/ui/Toast";
import { useTheme } from "@/ui/theme";

const THUMB = { width: 88, height: 88, borderRadius: 12 };
const MAX_PHOTOS = 5;

// No-show dispute (spec 3.3, APP-14): report a no-show, the other side's response, the deadline, both
// sides' evidence and the outcome. Photos come only from the camera, never the library (DSP-3).
export default function DisputeScreen() {
  const { tradeId } = useLocalSearchParams<{ tradeId: string }>();
  const { session } = useAccount();
  const myId = session?.user.id ?? "";
  const [data, setData] = useState<
    { trade: Trade; disputes: Dispute[]; evidence: Evidence[] } | null | undefined
  >();

  const load = useCallback(
    () =>
      Promise.all([fetchTrades([tradeId]), fetchDisputes(tradeId)]).then(([trades, claims]) =>
        setData(trades?.[0] && claims ? { trade: trades[0], ...claims } : null),
      ),
    [tradeId],
  );
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  if (data === undefined) {
    return (
      <>
        <Header title="No-show" />
        <ActivityIndicator className="flex-1 bg-bg" />
      </>
    );
  }
  if (data === null) {
    return (
      <>
        <Header title="No-show" />
        <Text className="flex-1 bg-bg px-8 pt-16 text-center text-base text-muted">
          {"We couldn't load this trade."}
        </Text>
      </>
    );
  }

  const { trade, disputes, evidence } = data;
  const partner = trade.seller_id === myId ? trade.buyer : trade.seller;
  const partnerName = partner?.display_name ?? "Deleted user";
  const mine = disputes.find((d) => d.opened_by === myId);

  const withEvidence = async (uris: string[], call: (paths: string[]) => PromiseLike<{ error: unknown }>) => {
    try {
      const paths = await Promise.all(uris.map((uri) => uploadEvidencePhoto(tradeId, myId, uri)));
      const { error } = await call(paths);
      if (error) {
        Alert.alert("Couldn't send", errorMessage(error, DISPUTE_MESSAGES));
        return false;
      }
      return true;
    } catch (error) {
      Alert.alert("Couldn't upload a photo", errorMessage(error));
      return false;
    }
  };

  return (
    <ScrollView className="flex-1 bg-bg" contentContainerStyle={{ padding: 20, gap: 24 }}>
      <Header title="No-show" />
      <Text className="text-[15px] text-muted">
        {trade.listing?.title ?? "Listing removed"} with {partnerName}
      </Text>

      {disputes.map((d) => (
        <View key={d.id} className="gap-3 rounded-2xl bg-surface p-4">
          <Text className="text-[15px] font-bold text-ink">
            {d.opened_by === myId ? "You reported a no-show" : `${partnerName} reported a no-show`}
          </Text>
          <Text className="text-[13px] text-muted">
            {DISPUTE_STATUS[d.status]}
            {d.status === "awaiting_response" ? ` · ${responseDue(d.response_due_at)}` : ""}
          </Text>
          <Text className="text-[15px] text-ink">{d.statement}</Text>
          <Photos items={evidence.filter((e) => e.dispute_id === d.id && e.user_id === d.opened_by)} />
          {evidence
            .filter((e) => e.dispute_id === d.id && e.user_id === d.against_id && e.kind === "statement")
            .map((e) => (
              <View key={e.id} className="gap-2 border-t border-line pt-3">
                <Text className="text-[13px] font-bold text-ink">
                  {d.against_id === myId ? "Your response" : `${partnerName}'s response`}
                </Text>
                <Text className="text-[15px] text-ink">{e.body}</Text>
              </View>
            ))}
          <Photos items={evidence.filter((e) => e.dispute_id === d.id && e.user_id === d.against_id)} />
          {d.resolution_note ? (
            <Text className="text-[13px] text-muted">Admin note: {d.resolution_note}</Text>
          ) : null}
          {d.status === "rejected" && d.bad_faith ? (
            <Text className="text-[13px] text-danger">The claim was judged to be made in bad faith.</Text>
          ) : null}

          {d.against_id === myId && d.status === "awaiting_response" ? (
            <EvidenceForm
              label="Send response"
              placeholder="What happened? Were you there?"
              onSubmit={(statement, uris) =>
                withEvidence(uris, (paths) =>
                  supabase.rpc("respond_dispute", {
                    p_dispute_id: d.id,
                    p_statement: statement,
                    p_photo_paths: paths,
                  }),
                ).then((ok) => {
                  if (ok) toast("Response sent. An admin will review it.");
                  void load();
                  return ok;
                })
              }
            />
          ) : null}
          {d.opened_by === myId && d.status === "awaiting_response" ? (
            <TextLink
              label="Withdraw report"
              onPress={() =>
                void supabase.rpc("withdraw_dispute", { p_dispute_id: d.id }).then(({ error }) => {
                  if (error) Alert.alert("Couldn't withdraw", errorMessage(error, DISPUTE_MESSAGES));
                  void load();
                })
              }
            />
          ) : null}
        </View>
      ))}

      {!mine && canClaimNow(trade) ? (
        <View className="gap-3">
          <Text className="text-lg font-extrabold text-ink">Report a no-show</Text>
          <Text className="text-[13px] text-muted">
            {partnerName} gets 48 hours to respond, then an admin decides. A claim found to be made in bad
            faith lowers your grade.
          </Text>
          <EvidenceForm
            label="Report no-show"
            placeholder={`What happened? When did you arrive, and how long did you wait for ${partnerName}?`}
            onSubmit={(statement, uris) =>
              withEvidence(uris, (paths) =>
                supabase.rpc("open_dispute", {
                  p_trade_id: tradeId,
                  p_type: "no_show",
                  p_statement: statement,
                  p_photo_paths: paths,
                }),
              ).then((ok) => {
                if (ok) toast(`Reported. ${partnerName} has 48 hours to respond.`);
                void load();
                return ok;
              })
            }
          />
        </View>
      ) : null}
      {!disputes.length && !canClaimNow(trade) ? (
        <Text className="text-[15px] text-muted">
          No-show reports open 15 minutes after the meetup and close 48 hours after it.
        </Text>
      ) : null}
    </ScrollView>
  );
}

function Photos({ items }: { items: Evidence[] }) {
  const photos = items.filter((e) => e.kind === "photo" && e.photo_path);
  if (!photos.length) return null;
  return (
    <View className="flex-row flex-wrap gap-2">
      {photos.map((e) => (
        <Photo
          key={e.id}
          path={e.photo_path!}
          bucket="dispute-evidence"
          style={THUMB}
          accessibilityLabel="Evidence photo"
        />
      ))}
    </View>
  );
}

// A statement and up to five camera photos.
function EvidenceForm({
  label,
  placeholder,
  onSubmit,
}: {
  label: string;
  placeholder: string;
  onSubmit: (statement: string, uris: string[]) => Promise<boolean>;
}) {
  const { colors } = useTheme();
  const [statement, setStatement] = useState("");
  const [uris, setUris] = useState<string[]>([]);
  const [sending, setSending] = useState(false);

  const shoot = async () => {
    const [uri] = await pickPhotos("camera", 1);
    if (uri) setUris((current) => [...current, uri]);
  };

  return (
    <View className="gap-3">
      <Field
        label="Statement"
        value={statement}
        onChangeText={setStatement}
        placeholder={placeholder}
        maxLength={2000}
        multiline
        style={{ height: 120, textAlignVertical: "top", paddingTop: 12 }}
      />
      <View className="flex-row flex-wrap gap-2">
        {uris.map((uri) => (
          <Pressable
            key={uri}
            accessibilityRole="button"
            accessibilityLabel="Remove photo"
            onPress={() => setUris((current) => current.filter((u) => u !== uri))}
          >
            <Image source={{ uri }} style={THUMB} contentFit="cover" />
          </Pressable>
        ))}
        {uris.length < MAX_PHOTOS ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Take a photo"
            onPress={() => void shoot()}
            className="items-center justify-center gap-1 rounded-xl border border-line"
            style={THUMB}
          >
            <Camera size={22} color={colors.ink} />
            <Text className="text-[12px] text-muted">Camera</Text>
          </Pressable>
        ) : null}
      </View>
      <Button
        label={sending ? "Sending…" : label}
        disabled={sending || !statement.trim()}
        onPress={() => {
          setSending(true);
          void onSubmit(statement.trim(), uris).then((ok) => {
            setSending(false);
            if (ok) {
              setStatement("");
              setUris([]);
            }
          });
        }}
      />
    </View>
  );
}
