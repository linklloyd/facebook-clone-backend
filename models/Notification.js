import mongoose from "mongoose";

const notificationSchema = new mongoose.Schema(
  {
    recipient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    type: {
      type: String,
      enum: [
        "like_post",
        "comment_post",
        "friend_request",
        "friend_accepted",
        "like_comment",
        "mention_post",
        "mention_comment",
      ],
      required: true,
    },
    reference: { type: mongoose.Schema.Types.ObjectId },
    referenceModel: {
      type: String,
      enum: ["Post", "Comment", "User"],
    },
    commentPreview: { type: String, default: "" },
    read: { type: Boolean, default: false },
    expiresAt: {
      type: Date,
      default: () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
      index: { expires: 0 },
    },
  },
  { timestamps: true }
);

export default mongoose.model("Notification", notificationSchema);
