const express = require("express");
const User = require("../models/User");

const router = express.Router();

// Create user
router.post("/", async (req, res) => {
    try {
        const { username, email, avatar } = req.body;

        const user = new User({
            username,
            email,
            avatar
        });

        const savedUser = await user.save();

        res.status(201).json(savedUser);
    } catch (error) {
        res.status(500).json({
            message: "Failed to create user",
            error: error.message
        });
    }
});

// Get all users
router.get("/", async (req, res) => {
    try {
        const users = await User.find();

        res.json(users);
    } catch (error) {
        res.status(500).json({
            message: "Failed to fetch users",
            error: error.message
        });
    }
});

module.exports = router;