// Small shared pieces: the logo, analyst avatars, role icons and team logos. Server-safe (no hooks).

export function Logo({ size = 28 }: { size?: number }) {
  return <img src="/brand/logo.svg" width={size} height={size} alt="" aria-hidden />;
}

export function Avatar({ name, color, art, size = 32, result }: { name: string; color: string; art?: string | null; size?: number; result?: "right" | "wrong" }) {
  return (
    <span className="avatar" title={name} style={{ width: size, height: size, background: `radial-gradient(circle at 30% 25%, #ffffff66 0, ${color} 60%)`, fontSize: size * 0.42 }}>
      {art ? <img src={art} alt={name} /> : name.slice(0, 1)}
      {result && <span className="tick" style={{ background: result === "right" ? "var(--win)" : "var(--loss)" }} />}
    </span>
  );
}

export function RoleIcon({ role, size = 16 }: { role: string; size?: number }) {
  return <img className="role" src={`/roles/${role}.png`} width={size} height={size} alt={role} />;
}

export function TeamLogo({ code, logo }: { code: string; logo: string | null }) {
  return logo ? <img className="tlogo" src={logo} alt={code} loading="lazy" /> : <span className="tlogo logo-fallback">{code}</span>;
}
