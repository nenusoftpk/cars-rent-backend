
import "../config/env.js";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import User from "../models/User.js";

const createSuperAdmin = async () => {
  try {
    const name = process.env.SUPER_ADMIN_NAME?.trim();
    const email = process.env.SUPER_ADMIN_EMAIL
      ?.trim()
      .toLowerCase();
    const password = process.env.SUPER_ADMIN_PASSWORD;

    if (!process.env.MONGODB_URI) {
      throw new Error("MONGODB_URI is missing.");
    }

    if (!name || !email || !password) {
      throw new Error("Super Admin ENV variables are required.");
    }

    if (password.length < 12) {
      throw new Error("Password must be at least 12 characters.");
    }

    await mongoose.connect(process.env.MONGODB_URI);
    console.log("MongoDB connected successfully.");

    const existing = await User.findOne({ email })
      .select("+tokenVersion");

    const hashedPassword = await bcrypt.hash(password, 12);

    if (existing) {
      if (existing.role !== "super-admin") {
        throw new Error(
          "Email already belongs to an Admin or Employee."
        );
      }

      if (existing.businessId) {
        throw new Error(
          "Super Admin cannot belong to a business."
        );
      }

      existing.name = name;
      existing.password = hashedPassword;
      existing.status = "active";
      existing.isEmailVerified = true;
      existing.emailVerifiedAt = new Date();
      existing.failedLoginAttempts = 0;
      existing.lockUntil = null;
      existing.passwordChangedAt = new Date();
      existing.tokenVersion =
        (existing.tokenVersion ?? 0) + 1;

      await existing.save();

      console.log("Super Admin updated successfully!");
    } else {
      await User.create({
        businessId: null,
        name,
        email,
        phone: "",
        password: hashedPassword,
        role: "super-admin",
        permissions: [],
        dataScope: "business",
        status: "active",
        isEmailVerified: true,
        emailVerifiedAt: new Date(),
        tokenVersion: 0,
        failedLoginAttempts: 0,
        lockUntil: null,
      });

      console.log("Super Admin created successfully!");
    }

    console.log("Email:", email);
    console.log("Role: super-admin");
    console.log("Status: active");

  } catch (error) {
    console.error("Seed failed:", error.message);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
};

createSuperAdmin();
