import mongoose from "mongoose";

const storySchema = new mongoose.Schema(
  {
    author: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    image: { type: String, default: "" },
    text: { type: String, default: "" },
    backgroundColor: { type: String, default: "#1877f2" },
    // Customization fields
    fontFamily: { type: String, default: "sans-serif" },
    fontSize: { type: Number, default: 28 },
    fontColor: { type: String, default: "#ffffff" },
    textAlign: { type: String, enum: ["left", "center", "right"], default: "center" },
    textPosition: { type: String, enum: ["top", "center", "bottom"], default: "center" },
    fontWeight: { type: String, enum: ["normal", "bold"], default: "bold" },
    fontStyle: { type: String, enum: ["normal", "italic"], default: "normal" },
    gradient: { type: String, default: "" }, // CSS gradient string, overrides backgroundColor
    viewers: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    expiresAt: {
      type: Date,
      default: () => new Date(Date.now() + 24 * 60 * 60 * 1000),
      index: { expires: 0 },
    },
  },
  { timestamps: true }
);

export default mongoose.model("Story", storySchema);
