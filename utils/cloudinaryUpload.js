
import cloudinary from "../config/cloudinary.js";
import sharp from "sharp";
import crypto from "node:crypto";

// ======================================================
// CONSTANTS
// ======================================================

const IMAGE_FORMATS = ["jpeg", "png", "webp"];

const MAX_IMAGE_PIXELS = 25_000_000;

// ======================================================
// HELPERS
// ======================================================

const createError = (message, status = 400) => {
  const error = new Error(message);
  error.status = status;
  error.statusCode = status;
  return error;
};


const validateFolder = (folder) => {
  if (typeof folder !== "string") {
    throw createError("Invalid Cloudinary folder.", 400);
  }

  // Supports:
  // rent-a-car/{businessId}/customers
  // rent-a-car/{businessId}/customers/guarantors
  // rent-a-car/{businessId}/cars
  // rent-a-car/{businessId}/drivers

  const FOLDER_REGEX =
    /^rent-a-car\/[a-fA-F0-9]{24}\/[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/;

  const isValid = FOLDER_REGEX.test(folder);

  console.log("[CLOUDINARY FOLDER CHECK]", {
    folder,
    isValid,
  });

  if (!isValid) {
    throw createError("Invalid Cloudinary folder.", 400);
  }
};

const validateResourceType = (resourceType) => {
  if (!["image", "raw", "video"].includes(resourceType)) {
    throw createError("Invalid resource type.", 400);
  }
};

// ======================================================
// VALIDATE AND PROCESS IMAGE
// ======================================================

export const processImage = async (
  buffer,
  {
    width = 1600,
    height = 1600,
    quality = 85,
  } = {}
) => {
  if (!Buffer.isBuffer(buffer) || !buffer.length) {
    throw createError("Invalid image file.");
  }

  let metadata;

  try {
    metadata = await sharp(buffer, {
      limitInputPixels: MAX_IMAGE_PIXELS,
    }).metadata();
  } catch {
    throw createError(
      "Invalid or corrupted image file."
    );
  }

  if (!IMAGE_FORMATS.includes(metadata.format)) {
    throw createError(
      "Only JPG, PNG and WEBP images are allowed."
    );
  }

  try {
    return await sharp(buffer, {
      limitInputPixels: MAX_IMAGE_PIXELS,
    })
      .rotate()
      .resize({
        width,
        height,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality })
      .toBuffer();
  } catch {
    throw createError("Unable to process image.", 400);
  }
};

// ======================================================
// VALIDATE FILE SIGNATURE
// ======================================================

const validateFileBuffer = async (
  buffer,
  resourceType
) => {
  if (!Buffer.isBuffer(buffer) || !buffer.length) {
    throw createError("File is missing or invalid.");
  }

  if (resourceType === "image") {
    return processImage(buffer);
  }

  if (resourceType === "raw") {
    const header = buffer
      .subarray(0, 5)
      .toString("ascii");

    if (header !== "%PDF-") {
      throw createError("Invalid PDF document.");
    }

    return buffer;
  }

  if (resourceType === "video") {
    // Video validation requires a dedicated media probe
    // or an equivalent trusted inspection service.
    // Do not accept videos solely by their MIME type.
    throw createError(
      "Video uploads require additional validation.",
      400
    );
  }

  throw createError("Unsupported resource type.");
};

// ======================================================
// UPLOAD TO CLOUDINARY
// ======================================================

export const uploadToCloudinary = async (
  fileBuffer,
  folder,
  resourceType = "image",
  isPrivate = false
) => {
  validateFolder(folder);
  validateResourceType(resourceType);

  const processedBuffer = await validateFileBuffer(
    fileBuffer,
    resourceType
  );

  return new Promise((resolve, reject) => {
    const options = {
      folder,
      resource_type: resourceType,
      type: isPrivate ? "authenticated" : "upload",
      overwrite: false,
      unique_filename: true,
    };

    // Preserve the PDF extension for raw uploads.
    if (resourceType === "raw") {
      options.public_id =
        `${crypto.randomUUID()}.pdf`;
    }

    const stream = cloudinary.uploader.upload_stream(
      options,
      (error, result) => {
        if (error) {
          console.error(
            "[Cloudinary] Upload failed:",
            error.message
          );

          return reject(error);
        }

        resolve(result);
      }
    );

    stream.end(processedBuffer);
  });
};

// ======================================================
// DELETE FROM CLOUDINARY
// ======================================================

export const deleteFromCloudinary = async (
  publicId,
  resourceType = "image",
  deliveryType = "upload"
) => {
  if (!publicId) return null;

  validateResourceType(resourceType);

  if (
    !["upload", "authenticated"].includes(deliveryType)
  ) {
    throw createError("Invalid delivery type.");
  }

  const result = await cloudinary.uploader.destroy(
    publicId,
    {
      resource_type: resourceType,
      type: deliveryType,
      invalidate: true,
    }
  );

  return result;
};

// ======================================================
// UPLOAD MULTIPLE FILES
// ======================================================

export const uploadMultipleToCloudinary = async (
  files,
  folder,
  resourceType = "image",
  isPrivate = false
) => {
  if (!Array.isArray(files) || !files.length) {
    return [];
  }

  const uploaded = [];

  try {
    for (const file of files) {
      const result = await uploadToCloudinary(
        file.buffer,
        folder,
        resourceType,
        isPrivate
      );

      uploaded.push(result);
    }

    return uploaded;
  } catch (error) {
    await Promise.allSettled(
      uploaded.map((item) =>
        deleteFromCloudinary(
          item.public_id,
          resourceType,
          isPrivate ? "authenticated" : "upload"
        )
      )
    );

    throw error;
  }
};

// ======================================================
// DELETE MULTIPLE FILES
// ======================================================

export const deleteMultipleFromCloudinary = async (
  publicIds,
  resourceType = "image",
  deliveryType = "upload"
) => {
  if (!Array.isArray(publicIds) || !publicIds.length) {
    return [];
  }

  return Promise.allSettled(
    publicIds.map((publicId) =>
      deleteFromCloudinary(
        publicId,
        resourceType,
        deliveryType
      )
    )
  );
};
