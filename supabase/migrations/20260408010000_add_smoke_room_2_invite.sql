-- Add invite column for Smoke Room 2.0
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS smoke_room_2_invited boolean NOT NULL DEFAULT false;

-- Add room support for multiple chat rooms
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS room text NOT NULL DEFAULT 'smoke_room';
CREATE INDEX IF NOT EXISTS idx_chat_messages_room_created_at ON chat_messages(room, created_at);