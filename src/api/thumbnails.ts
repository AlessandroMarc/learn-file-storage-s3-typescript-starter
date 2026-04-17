import { getBearerToken, validateJWT } from "../auth";
import { respondWithJSON } from "./json";
import { getVideo, updateVideo } from "../db/videos";
import type { ApiConfig } from "../config";
import type { BunRequest } from "bun";
import { BadRequestError, NotFoundError } from "./errors";
import path from "path";

type Thumbnail = {
  data: ArrayBuffer;
  mediaType: string;
};

const videoThumbnails: Map<string, Thumbnail> = new Map();

const MAX_UPLOAD_SIZE = 10 * 1024 * 1024;

export async function handlerGetThumbnail(cfg: ApiConfig, req: BunRequest) {
  const { videoId } = req.params as { videoId?: string };
  if (!videoId) {
    throw new BadRequestError("Invalid video ID");
  }

  const video = getVideo(cfg.db, videoId);
  if (!video) {
    throw new NotFoundError("Couldn't find video");
  }

  const thumbnail = videoThumbnails.get(videoId);
  if (!thumbnail) {
    throw new NotFoundError("Thumbnail not found");
  }

  return new Response(thumbnail.data, {
    headers: {
      "Content-Type": thumbnail.mediaType,
      "Cache-Control": "no-store",
    },
  });
}

export async function handlerUploadThumbnail(cfg: ApiConfig, req: BunRequest) {
  const { videoId } = req.params as { videoId?: string };
  if (!videoId) {
    throw new BadRequestError("Invalid video ID");
  }

  const token = getBearerToken(req.headers);
  const userID = validateJWT(token, cfg.jwtSecret);

  console.log("uploading thumbnail for video", videoId, "by user", userID);

  const formData = await req.formData();
  const file = formData.get("thumbnail") as File | null;
  if (!file) {
    throw new BadRequestError("No thumbnail file provided");
  }

  if (!(file instanceof File)) {
    throw new BadRequestError("Invalid thumbnail file");
  }

  if (file.size > MAX_UPLOAD_SIZE) {
    throw new BadRequestError("Thumbnail file is too large");
  }

  var mediaType = file.type;

  if (!mediaType.startsWith("image/")) {
    throw new BadRequestError("Invalid thumbnail file type");
  }

  const imageData: ArrayBuffer = await file.arrayBuffer();

  const extension = mediaType.split("/")[1] || "bin";
  const filePath = path.join(cfg.assetsRoot, `${videoId}.${extension}`);

  await Bun.write(filePath, imageData);

  var video = getVideo(cfg.db, videoId);
  if (!video) {
    throw new NotFoundError("Couldn't find video");
  }

  if (video.userID !== userID) {
    throw new BadRequestError("User not authorized to upload thumbnail for this video");
  }

  const thumbnailUrl = `/assets/${videoId}.${extension}`;

  video.thumbnailURL = thumbnailUrl;

  updateVideo(cfg.db, video);

  return respondWithJSON(200, video);
}
