import mongoose from 'mongoose';

// A person LINEA says is using agents (their username is LINEA's). Agents keeps no session and no git host token of theirs.
const userSchema = new mongoose.Schema({
  username: {
    type: String,
    unique: true,
    required: true,
  },
  admin: {
    type: Boolean,
    default: false,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  avatarUrl: {
    type: String,
    required: false,
  },
});

const User = mongoose.model('User', userSchema);

export default User;
