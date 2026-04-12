import PrivateRoomFeedClient from "../PrivateRoomFeedClient";

export const dynamic = "force-dynamic";

export default function PsychonauticsPage() {
  return <PrivateRoomFeedClient room="psychonautics" />;
}