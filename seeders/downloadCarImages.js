import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const IMAGES_FOLDER = path.join(__dirname, "images");

const API_KEY = process.env.CAR_IMAGE_API_KEY;

const API_URL =
    "https://carimage.dev/api/v1/images/car";

// ======================================================
// CAR MODELS
// ======================================================

const cars = [
    ["Toyota", "Corolla GLI", 2019, "corolla", 2019],
    ["Toyota", "Corolla Altis", 2023],
    ["Toyota", "Yaris", 2023],
    ["Toyota", "Fortuner", 2023],
    ["Toyota", "Hilux Revo", 2023, "hilux", 2023],

    ["Honda", "Civic", 2023],
    ["Honda", "City", 2023],
    ["Honda", "BR-V", 2023, "br-v", 2022],

    ["Suzuki", "Alto", 2023, "alto", 2024],
    ["Suzuki", "Cultus", 2023, "celerio", 2022],
    ["Suzuki", "Wagon R", 2023, "wagon-r", 2022],
    ["Suzuki", "Swift", 2023],

    ["Kia", "Sportage", 2023],
    ["Kia", "Picanto", 2023],

    ["Hyundai", "Tucson", 2023],
    ["Hyundai", "Elantra", 2023],

    ["MG", "HS", 2023],

    ["Changan", "Alsvin", 2023, "alsvin-plus", 2026],
    ["Changan", "Oshan X7", 2023, "x7-plus", 2026],

    ["Haval", "H6", 2023],
];

// ======================================================
// HELPERS
// ======================================================

const sleep = (ms) =>
    new Promise((resolve) => setTimeout(resolve, ms));

const slugify = (value) =>
    value
        .toLowerCase()
        .trim()
        .replace(/\s+/g, "-");

const extensions = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
};

// ======================================================
// DOWNLOAD IMAGE
// ======================================================

const downloadCarImage = async (
    brand,
    model,
    year,
    apiModel = model,
    apiYear = year
) => {
    const filename = slugify(`${brand} ${model}`);

    const existingFiles = await fs.readdir(IMAGES_FOLDER);

    const alreadyExists = existingFiles.some((file) =>
        [".jpg", ".jpeg", ".png", ".webp"].some(
            (ext) => file === `${filename}${ext}`
        )
    );

    if (alreadyExists) {
        console.log(`[EXISTS] ${brand} ${model}`);
        return "skipped";
    }

    const params = new URLSearchParams({
        make: brand.toLowerCase(),
        model: apiModel.toLowerCase(),
        year: String(apiYear),
        view: "front-3-4",
        color: "white",
    });

    const response = await fetch(
        `${API_URL}?${params.toString()}`,
        {
            headers: {
                Authorization: `Bearer ${API_KEY}`,
            },
            signal: AbortSignal.timeout(120000),
        }
    );

    if (!response.ok) {
        const message = await response.text();

        throw new Error(
            `HTTP ${response.status}: ${message.slice(0, 300)}`
        );
    }

    const contentType = response.headers
        .get("content-type")
        ?.split(";")[0]
        .trim();

    const extension = extensions[contentType];

    if (!extension) {
        throw new Error(
            `Unsupported response type: ${contentType}`
        );
    }

    const buffer = Buffer.from(
        await response.arrayBuffer()
    );

    if (buffer.length === 0) {
        throw new Error("Empty image received.");
    }

    const imagePath = path.join(
        IMAGES_FOLDER,
        `${filename}${extension}`
    );

    await fs.writeFile(imagePath, buffer);

    console.log(
        `[DOWNLOADED] ${filename}${extension}`
    );

    return "downloaded";
};

// ======================================================
// MAIN FUNCTION
// ======================================================

const downloadCarImages = async () => {
    console.log("==================================");
    console.log("MODEL SPECIFIC CAR IMAGES");
    console.log("==================================");

    if (!API_KEY) {
        throw new Error(
            "CAR_IMAGE_API_KEY is missing in .env"
        );
    }

    await fs.mkdir(IMAGES_FOLDER, {
        recursive: true,
    });

    let downloaded = 0;
    let skipped = 0;
    let failed = 0;

    for (const [
        brand,
        model,
        year,
        apiModel,
        apiYear
    ] of cars) {
        try {
            console.log(`[PROCESSING] ${brand} ${model}`);

            const result = await downloadCarImage(
                brand,
                model,
                year,
                apiModel,
                apiYear
            );

            if (result === "downloaded") {
                downloaded++;
            } else {
                skipped++;
            }

        } catch (error) {
            failed++;

            console.error(
                `[FAILED] ${brand} ${model}:`,
                error.cause || error.message
            );
        }

        await sleep(2000);
    }

    console.log("==================================");
    console.log("DOWNLOAD COMPLETED");
    console.log("==================================");

    console.log(`Total models: ${cars.length}`);
    console.log(`Downloaded: ${downloaded}`);
    console.log(`Already exists: ${skipped}`);
    console.log(`Failed: ${failed}`);
    console.log(`Images folder: ${IMAGES_FOLDER}`);

    console.log("==================================");

    if (failed > 0) {
        process.exitCode = 1;
    }
};

downloadCarImages().catch((error) => {
    console.error(error.cause || error.message);
    process.exitCode = 1;
});