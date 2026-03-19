import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";
import dotenv from "dotenv";
// Images are hosted on Imgur — no local file serving needed
import connectDB from "./config/db.js";
import authRoutes from "./routes/auth.js";
import userRoutes from "./routes/users.js";
import postRoutes from "./routes/posts.js";
import messageRoutes from "./routes/messages.js";
import notificationRoutes from "./routes/notifications.js";
import storyRoutes from "./routes/stories.js";
import activityRoutes from "./routes/activity.js";
import marketplaceRoutes from "./routes/marketplace.js";
import User from "./models/User.js";

dotenv.config();


const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_URL || "http://localhost:5173",
    methods: ["GET", "POST", "PUT", "DELETE"],
  },
});

// Middleware
const allowedOrigins = (process.env.CLIENT_URL || "http://localhost:5173").split(",");
app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use(express.json({ limit: "15mb" }));
app.use(express.urlencoded({ limit: "15mb", extended: true }));
// Images hosted on Imgur — no local /uploads static serving

// Make io available to routes
app.set("io", io);

// Online users map: userId -> socketId
const onlineUsers = new Map();
app.set("onlineUsers", onlineUsers);

// Socket.io
io.on("connection", (socket) => {
  const userId = socket.handshake.query.userId;
  if (userId) {
    onlineUsers.set(userId, socket.id);
    User.findByIdAndUpdate(userId, { isOnline: true }).exec();
    io.emit("onlineUsers", Array.from(onlineUsers.keys()));
  }

  socket.on("typing", ({ conversationId, receiverIds }) => {
    const targets = Array.isArray(receiverIds) ? receiverIds : [receiverIds];
    for (const rid of targets) {
      const receiverSocket = onlineUsers.get(rid);
      if (receiverSocket) {
        io.to(receiverSocket).emit("typing", { conversationId, userId });
      }
    }
  });

  socket.on("stopTyping", ({ conversationId, receiverIds }) => {
    const targets = Array.isArray(receiverIds) ? receiverIds : [receiverIds];
    for (const rid of targets) {
      const receiverSocket = onlineUsers.get(rid);
      if (receiverSocket) {
        io.to(receiverSocket).emit("stopTyping", { conversationId, userId });
      }
    }
  });

  socket.on("disconnect", () => {
    if (userId) {
      onlineUsers.delete(userId);
      User.findByIdAndUpdate(userId, {
        isOnline: false,
        lastSeen: new Date(),
      }).exec();
      io.emit("onlineUsers", Array.from(onlineUsers.keys()));
    }
  });
});

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/posts", postRoutes);
app.use("/api/messages", messageRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/stories", storyRoutes);
app.use("/api/activity", activityRoutes);
app.use("/api/marketplace", marketplaceRoutes);

// Connect to DB and start server
const PORT = process.env.PORT || 5000;
connectDB().then(() => {
  server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
});
