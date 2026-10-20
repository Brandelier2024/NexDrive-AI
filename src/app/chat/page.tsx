import { Suspense } from "react";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import ChatUI from "../chat-ui";

async function AuthenticatedChat() {
  const session = await auth();

  // If not authenticated, redirect to sign in
  if (!session?.user) {
    redirect("/auth/signin?callbackUrl=/chat");
  }

  return (
    <ChatUI
      user={{
        name: session.user.name,
        email: session.user.email,
        image: session.user.image,
      }}
    />
  );
}

export default function ChatPage() {
  return (
    <Suspense
      fallback={
        <div
          style={{
            height: "100vh",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "var(--color-bg, #f8f9fc)",
          }}
        >
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: "50%",
              border: "3px solid #e2e8f0",
              borderTopColor: "#4f46e5",
              animation: "spin 0.8s linear infinite",
            }}
          />
        </div>
      }
    >
      <AuthenticatedChat />
    </Suspense>
  );
}
