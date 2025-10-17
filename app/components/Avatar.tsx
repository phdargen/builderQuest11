/**
 * Avatar component for displaying user profile pictures
 * Shows default avatar from /pfp.png if no pfpUrl provided
 */

interface AvatarProps {
  pfpUrl: string | null;
  displayName: string;
  size?: number; // in pixels
  className?: string;
}

export default function Avatar({ pfpUrl, displayName, size = 40, className = "" }: AvatarProps) {
  const avatarSrc = pfpUrl || "/pfp.png";

  return (
    <div
      className={`avatar ${className}`}
      style={{
        width: `${size}px`,
        height: `${size}px`,
        borderRadius: "50%",
        overflow: "hidden",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "transparent",
        flexShrink: 0,
      }}
    >
      <img
        src={avatarSrc}
        alt={displayName}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
        }}
        onError={(e) => {
          // Fallback to default pfp.png if custom image fails to load
          const target = e.target as HTMLImageElement;
          if (target.src !== "/pfp.png") {
            target.src = "/pfp.png";
          }
        }}
      />
    </div>
  );
}

