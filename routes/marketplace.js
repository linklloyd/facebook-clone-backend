import { Router } from "express";
import MarketplaceItem from "../models/MarketplaceItem.js";
import auth from "../middleware/auth.js";
import upload from "../middleware/upload.js";
import { uploadToImgur } from "../utils/imgur.js";

const router = Router();

// List all items (newest first, optional filters)
router.get("/", auth, async (req, res) => {
  try {
    const { category, minPrice, maxPrice, sold } = req.query;
    const filter = {};
    if (category) filter.category = category;
    if (sold === "false") filter.sold = false;
    if (minPrice || maxPrice) {
      filter.price = {};
      if (minPrice) filter.price.$gte = Number(minPrice);
      if (maxPrice) filter.price.$lte = Number(maxPrice);
    }
    const items = await MarketplaceItem.find(filter)
      .sort({ createdAt: -1 })
      .populate("seller", "firstName lastName profilePicture")
      .limit(50);
    res.json(items);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Search items
router.get("/search", auth, async (req, res) => {
  try {
    const { q, category } = req.query;
    const filter = { sold: false };
    if (q) {
      filter.$or = [
        { title: { $regex: q, $options: "i" } },
        { description: { $regex: q, $options: "i" } },
      ];
    }
    if (category) filter.category = category;
    const items = await MarketplaceItem.find(filter)
      .sort({ createdAt: -1 })
      .populate("seller", "firstName lastName profilePicture")
      .limit(50);
    res.json(items);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Get single item
router.get("/:id", auth, async (req, res) => {
  try {
    const item = await MarketplaceItem.findById(req.params.id).populate(
      "seller",
      "firstName lastName profilePicture"
    );
    if (!item) return res.status(404).json({ message: "Item not found" });
    res.json(item);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Create listing
router.post("/", auth, upload.array("images", 5), async (req, res) => {
  try {
    const { title, description, price, currency, category, condition, location } = req.body;
    if (!title || !price) {
      return res.status(400).json({ message: "Title and price are required" });
    }

    let images = [];
    if (req.files && req.files.length > 0) {
      const promises = req.files.map((f) => {
        if (f.mimetype.startsWith("video/")) {
          return Promise.resolve(null); // skip videos for marketplace
        }
        return uploadToImgur(f.buffer);
      });
      images = (await Promise.all(promises)).filter(Boolean);
    }

    const item = await MarketplaceItem.create({
      seller: req.userId,
      title,
      description: description || "",
      price: Number(price),
      currency: currency || "MXN",
      images,
      category: category || "Other",
      condition: condition || "Used",
      location: location || "",
    });

    const populated = await item.populate("seller", "firstName lastName profilePicture");
    res.status(201).json(populated);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Update listing (seller only)
router.put("/:id", auth, upload.array("images", 5), async (req, res) => {
  try {
    const item = await MarketplaceItem.findById(req.params.id);
    if (!item) return res.status(404).json({ message: "Item not found" });
    if (item.seller.toString() !== req.userId) {
      return res.status(403).json({ message: "Not authorized" });
    }

    const { title, description, price, currency, category, condition, location } = req.body;
    if (title) item.title = title;
    if (description !== undefined) item.description = description;
    if (price) item.price = Number(price);
    if (currency) item.currency = currency;
    if (category) item.category = category;
    if (condition) item.condition = condition;
    if (location !== undefined) item.location = location;

    // Append new images if uploaded
    if (req.files && req.files.length > 0) {
      const promises = req.files.map((f) => uploadToImgur(f.buffer));
      const newImages = await Promise.all(promises);
      item.images = [...item.images, ...newImages];
    }

    await item.save();
    const populated = await item.populate("seller", "firstName lastName profilePicture");
    res.json(populated);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Mark as sold
router.put("/:id/sold", auth, async (req, res) => {
  try {
    const item = await MarketplaceItem.findById(req.params.id);
    if (!item) return res.status(404).json({ message: "Item not found" });
    if (item.seller.toString() !== req.userId) {
      return res.status(403).json({ message: "Not authorized" });
    }
    item.sold = !item.sold;
    await item.save();
    const populated = await item.populate("seller", "firstName lastName profilePicture");
    res.json(populated);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Delete listing (seller only)
router.delete("/:id", auth, async (req, res) => {
  try {
    const item = await MarketplaceItem.findById(req.params.id);
    if (!item) return res.status(404).json({ message: "Item not found" });
    if (item.seller.toString() !== req.userId) {
      return res.status(403).json({ message: "Not authorized" });
    }
    await item.deleteOne();
    res.json({ message: "Listing deleted" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

export default router;
