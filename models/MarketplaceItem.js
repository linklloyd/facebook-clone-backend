import mongoose from "mongoose";

const marketplaceItemSchema = new mongoose.Schema(
  {
    seller: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    title: { type: String, required: true, trim: true },
    description: { type: String, default: "" },
    price: { type: Number, required: true, min: 0 },
    currency: { type: String, default: "MXN" },
    images: [{ type: String }],
    category: {
      type: String,
      enum: [
        "Electronics",
        "Vehicles",
        "Furniture",
        "Clothing",
        "Home",
        "Sports",
        "Toys",
        "Other",
      ],
      default: "Other",
    },
    condition: {
      type: String,
      enum: ["New", "Like New", "Good", "Used"],
      default: "Used",
    },
    location: { type: String, default: "" },
    sold: { type: Boolean, default: false },
  },
  { timestamps: true }
);

marketplaceItemSchema.index({ title: "text", description: "text" });

export default mongoose.model("MarketplaceItem", marketplaceItemSchema);
