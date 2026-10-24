import { randomUUID } from "expo-crypto";
import { File } from "expo-file-system";
import { Image } from "expo-image";
import { ImageManipulator, SaveFormat, type ImageRef } from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";

import type { Bucket } from "./photoUrls";
import { supabase } from "./supabase";

// The only place that compresses, uploads and names photos (spec 4.7). Rows store object paths, never
// URLs, so moving photos to another store changes this module and photoUrls.ts, not the screens.

// Spec 4.7.1: long edge and size target per variant; WebP at 0.75, then 0.65 and 0.55 if still too big.
const DETAIL = { edge: 1600, maxBytes: 300_000 };
const THUMB = { edge: 400, maxBytes: 30_000 };
const QUALITIES = [0.75, 0.65, 0.55];

export type Encoded = { uri: string; bytes: number; format: "webp" | "jpeg" };
export type PreparedPhoto = { detail: Encoded; thumb: Encoded; blurhash: string };
export type UploadedPhoto = { path: string; thumb_path: string; blurhash: string; bytes: number };

// Encodes at each quality until the file fits; if none fits, keeps the smallest attempt (the bucket's
// 400 KB limit still guards the server).
export async function encodeToTarget(
  encode: (quality: number) => Promise<Encoded>,
  maxBytes: number,
  qualities: number[] = QUALITIES,
): Promise<Encoded> {
  let smallest: Encoded | null = null;
  for (const quality of qualities) {
    const result = await encode(quality);
    if (result.bytes <= maxBytes) return result;
    if (!smallest || result.bytes < smallest.bytes) smallest = result;
  }
  return smallest!;
}

async function save(image: ImageRef, quality: number): Promise<Encoded> {
  // Some devices cannot encode WebP; JPEG at the same quality is the fallback.
  let format: Encoded["format"] = "webp";
  let saved;
  try {
    saved = await image.saveAsync({ format: SaveFormat.WEBP, compress: quality });
  } catch {
    format = "jpeg";
    saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: quality });
  }
  return { uri: saved.uri, bytes: new File(saved.uri).size ?? 0, format };
}

// Smaller originals are never upscaled.
async function resized(original: ImageRef, edge: number): Promise<ImageRef> {
  if (Math.max(original.width, original.height) <= edge) return original;
  const size = original.width >= original.height ? { width: edge } : { height: edge };
  return ImageManipulator.manipulate(original).resize(size).renderAsync();
}

// Re-encoding drops EXIF, including GPS, so nothing from the original file is uploaded.
export async function preparePhoto(uri: string): Promise<PreparedPhoto> {
  const original = await ImageManipulator.manipulate(uri).renderAsync();
  const [detailImage, thumbImage] = await Promise.all([
    resized(original, DETAIL.edge),
    resized(original, THUMB.edge),
  ]);
  const detail = await encodeToTarget((q) => save(detailImage, q), DETAIL.maxBytes);
  const thumb = await encodeToTarget((q) => save(thumbImage, q), THUMB.maxBytes);
  const blurhash = (await Image.generateBlurhashAsync(thumb.uri, [4, 3])) ?? "";
  return { detail, thumb, blurhash };
}

async function put(bucket: Bucket, path: string, file: Encoded) {
  const { error } = await supabase.storage.from(bucket).upload(path, await new File(file.uri).arrayBuffer(), {
    contentType: `image/${file.format}`,
    // Paths are random and never reused, so an object never changes (spec 4.7.1).
    cacheControl: "31536000",
    upsert: false,
  });
  if (error) throw error;
}

// Uploads into the user's folder, which the storage policy requires, and returns the photo row fields.
export async function uploadPhoto(userId: string, photo: PreparedPhoto): Promise<UploadedPhoto> {
  const id = randomUUID();
  const path = `${userId}/${id}.${photo.detail.format === "webp" ? "webp" : "jpg"}`;
  const thumb_path = `${userId}/${id}_t.${photo.thumb.format === "webp" ? "webp" : "jpg"}`;
  await Promise.all([
    put("listing-photos", path, photo.detail),
    put("listing-photos", thumb_path, photo.thumb),
  ]);
  return { path, thumb_path, blurhash: photo.blurhash, bytes: photo.detail.bytes + photo.thumb.bytes };
}

// A chat photo is one detail-size image under {chat_id}/{user_id}/, the folder the chat-images policy
// requires (spec 4.9); bubbles show it scaled down. Returns the object path for send_message.
export async function uploadChatPhoto(chatId: string, userId: string, uri: string): Promise<string> {
  const original = await ImageManipulator.manipulate(uri).renderAsync();
  const image = await resized(original, DETAIL.edge);
  const detail = await encodeToTarget((q) => save(image, q), DETAIL.maxBytes);
  const path = `${chatId}/${userId}/${randomUUID()}.${detail.format === "webp" ? "webp" : "jpg"}`;
  await put("chat-images", path, detail);
  return path;
}

// Returns local image URIs, or [] when the user cancels or denies the camera.
export async function pickPhotos(source: "library" | "camera", limit: number): Promise<string[]> {
  if (source === "camera") {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) return [];
  }
  const options: ImagePicker.ImagePickerOptions = {
    mediaTypes: ["images"],
    quality: 1,
    exif: false,
    allowsMultipleSelection: source === "library" && limit > 1,
    selectionLimit: limit,
  };
  const result =
    source === "camera"
      ? await ImagePicker.launchCameraAsync(options)
      : await ImagePicker.launchImageLibraryAsync(options);
  return result.canceled ? [] : result.assets.slice(0, limit).map((asset) => asset.uri);
}
