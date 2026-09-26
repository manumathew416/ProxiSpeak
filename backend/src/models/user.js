const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
    {
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
            type: {
                type: String,
                enum: ["Point"],
                required: true,
                default: "Point"
            },

            coordinates: {
                type: [Number],
                required: true,
                default: [0, 0]
            }
        }
    },
    {
        timestamps: true
    }
);

// Geospatial index
userSchema.index({
    position: "2dsphere"
});

module.exports = mongoose.model("User", userSchema);