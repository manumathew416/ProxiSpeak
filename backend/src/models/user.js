const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
    socketId: {
        type: String,
        required: true,
        unique: true
    },

    username: {
        type: String,
        required: true,
        trim: true
    },

    position: {
        type: [Number],
        required: true,
        default: [0, 0]
    }
});

userSchema.index({
    position: "2d"
});

const User = mongoose.model("User", userSchema);

module.exports = User;