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
    read: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export default mongoose.model("Notification", notificationSchema);
