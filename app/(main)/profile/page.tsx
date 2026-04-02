"use client";

export default function ProfilePage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-900 via-teal-800 to-green-900 pt-20 p-8">
      <div className="max-w-3xl mx-auto text-white text-center">
        <div className="h-40 w-full bg-gradient-to-r from-cyan-500 to-blue-700 rounded-3xl mb-[-4rem]" />
        <div className="relative flex flex-col items-center">
          <div className="w-32 h-32 rounded-full border-4 border-white bg-gradient-to-br from-blue-400 to-green-400 mt-[-4rem] mb-4" />
          <h1 className="text-6xl font-extrabold mb-4 drop-shadow-lg">My Cosmic Profile</h1>
          <p className="text-xl text-cyan-200 mb-8">This is your cosmic bio. Shine bright in the universe!</p>
          <div className="bg-white/10 p-8 rounded-2xl border border-white/20 mb-8">
            <h2 className="text-2xl font-bold mb-2 text-cyan-300">Bio</h2>
            <p className="text-lg text-cyan-100">No bio set yet. Edit your profile to add one!</p>
          </div>
          <div className="bg-white/10 p-8 rounded-2xl border border-white/20 mb-8">
            <h2 className="text-2xl font-bold mb-2 text-cyan-300">Posts</h2>
            <p className="text-lg text-cyan-100">No posts yet.</p>
          </div>
          <button className="mt-4 px-8 py-3 rounded-full bg-gradient-to-r from-cyan-500 to-blue-700 text-white font-bold text-lg shadow-lg hover:scale-105 transition-transform">Edit Profile</button>
        </div>
      </div>
    </div>
  );
}
