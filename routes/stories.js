import { Router } from "express";
import Story from "../models/Story.js";
import User from "../models/User.js";
import auth from "../middleware/auth.js";
import upload from "../middleware/upload.js";
import { uploadToImgur } from "../utils/imgur.js";

const router = Router();

// Create story
router.post("/", auth, upload.single("image"), async (req, res) => {
  try {
    const storyData = {
      author: req.userId,
      text: req.body.text || "",
      backgroundColor: req.body.backgroundColor || "#1877f2",
    };
    if (req.file) {
      storyData.image = await uploadToImgur(req.file.buffer);
    }
    if (!storyData.text && !storyData.image) {
      return res.status(400).json({ message: "Story must have text or image" });
    }
    const story = await Story.create(storyData);
    const populated = await story.populate(
      "author",
      "firstName lastName profilePicture"
    );
    res.status(201).json(populated);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Get stories feed (own + friends)
router.get("/feed", auth, async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    const stories = await Story.find({
      author: { $in: [req.userId, ...user.friends] },
      expiresAt: { $gt: new Date() },
    })
      .populate("author", "firstName lastName profilePicture")
      .sort({ createdAt: -1 });

    // Group by author
    const grouped = {};
    stories.forEach((story) => {
      const authorId = story.author._id.toString();
      if (!grouped[authorId]) {
        grouped[authorId] = {
          author: story.author,
          stories: [],
        };
      }
      grouped[authorId].stories.push(story);
    });

    res.json(Object.values(grouped));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// View story
router.put("/:id/view", auth, async (req, res) => {
  try {
    await Story.findByIdAndUpdate(req.params.id, {
      $addToSet: { viewers: req.userId },
    });
    res.json({ message: "Viewed" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

export default router;
