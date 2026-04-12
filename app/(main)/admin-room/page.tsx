import PrivateRoomFeedClient from "../PrivateRoomFeedClient";

export const dynamic = "force-dynamic";

export default function AdminRoomPage() {
  return <PrivateRoomFeedClient room="admin_room" />;
}