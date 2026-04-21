import { respondWithJSON } from "./json";

import { type ApiConfig } from "../config";
import { type BunRequest } from "bun";
import { BadRequestError, NotFoundError, UserForbiddenError } from "./errors";
import { getBearerToken, validateJWT } from "../auth";
import { getVideo, updateVideo } from "../db/videos";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { unlink } from "node:fs/promises";

const MAX_UPLOAD_SIZE = 1 << 30;

export async function handlerUploadVideo(cfg: ApiConfig, req: BunRequest) {
  const { videoId } = req.params as { videoId?: string };
  if (!videoId) {
    throw new BadRequestError("Invalid video ID");
  }

  const token = getBearerToken(req.headers);
  const userID = validateJWT(token, cfg.jwtSecret);

  const video = getVideo(cfg.db, videoId);
  if (!video) {
    throw new NotFoundError("Couldn't find video");
  }

  if (userID !== video.userID) {
    throw new UserForbiddenError("User not authorized to upload video for this video");
  }

  const formData = await req.formData();
  const file = formData.get("video") as File | null;
  if (!file) {
    throw new BadRequestError("No video file provided");
  }

  if (!(file instanceof File)) {
    throw new BadRequestError("Invalid video file");
  }

  if (file.size > MAX_UPLOAD_SIZE) {
    throw new BadRequestError("Video file is too large");
  }

  const mediaType = file.type;
  if (mediaType !== "video/mp4") {
    throw new BadRequestError("Invalid video file type");
  }

  const extension = mediaType.split("/")[1] || "bin";
  const tmpPath = join(cfg.filepathRoot, `${randomBytes(32).toString("hex")}.${extension}`);

  try {
    await Bun.write(tmpPath, await file.arrayBuffer());

    const key = `${randomBytes(32).toString("hex")}.${extension}`;
    await cfg.s3Client.write(key, Bun.file(tmpPath), { type: mediaType });

    video.videoURL = `https://${cfg.s3Bucket}.s3.${cfg.s3Region}.amazonaws.com/${key}`;
    updateVideo(cfg.db, video);
  } finally {
    await unlink(tmpPath).catch(() => {});
  }

  return respondWithJSON(200, video);
}
