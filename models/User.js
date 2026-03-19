import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true },
    password: { type: String, required: true, minlength: 6 },
    profilePicture: { type: String, default: "" },
    coverPicture: { type: String, default: "" },
    bio: { type: String, default: "", maxlength: 200 },
    city: { type: String, default: "" },
    hometown: { type: String, default: "" },
    workplace: { type: String, default: "" },
    relationship: {
      type: String,
      enum: ["Single", "In a relationship", "Married", "Complicated", ""],
      default: "",
    },
    friends: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    pinnedPost: { type: mongoose.Schema.Types.ObjectId, ref: "Post", default: null },
    isOnline: { type: Boolean, default: false },
    lastSeen: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

userSchema.virtual("fullName").get(function () {
  return `${this.firstName} ${this.lastName}`;
});

userSchema.set("toJSON", { virtuals: true });

export default mongoose.model("User", userSchema);
