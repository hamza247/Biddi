import { useState } from "react";

const VEHICLE_TYPES = [
  { id: "moto",    label: "Moto",         icon: "🏍️", count: 1, isNew: false },
  { id: "plus",    label: "Ride+",        icon: "🚗", count: 4, isNew: true  },
  { id: "taxi",    label: "Taxi",         icon: "🚕", count: 3, isNew: false },
  { id: "city",    label: "City to city", icon: "🚙", count: 2, isNew: false },
  { id: "freight", label: "Freight",      icon: "🚚", count: 0, isNew: false },
];

const NEARBY_DRIVERS = [
  { id: 1, top: "18%", left: "18%",  rotate: "-30deg" },
  { id: 2, top: "22%", left: "65%",  rotate: "45deg"  },
  { id: 3, top: "35%", left: "82%",  rotate: "10deg"  },
  { id: 4, top: "50%", left: "12%",  rotate: "-60deg" },
  { id: 5, top: "44%", left: "55%",  rotate: "80deg"  },
  { id: 6, top: "60%", left: "75%",  rotate: "-20deg" },
  { id: 7, top: "14%", left: "40%",  rotate: "15deg"  },
];

export function RiderHomeRedesign() {
  const [selected, setSelected] = useState("plus");

  return (
    <div
      style={{
        width: 390,
        height: 844,
        position: "relative",
        overflow: "hidden",
        fontFamily: "-apple-system, 'Inter', sans-serif",
        background: "#fff",
        margin: "0 auto",
      }}
    >
      {/* ── Map Background ── */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "linear-gradient(160deg, #e8f0e9 0%, #dce8da 30%, #cddacc 60%, #d4e0d4 100%)",
        }}
      >
        {/* Street grid lines */}
        <svg width="100%" height="100%" style={{ position: "absolute", inset: 0 }}>
          {/* Horizontal roads */}
          <line x1="0" y1="120" x2="390" y2="105" stroke="#fff" strokeWidth="6" opacity="0.9" />
          <line x1="0" y1="200" x2="390" y2="220" stroke="#fff" strokeWidth="4" opacity="0.7" />
          <line x1="0" y1="280" x2="390" y2="265" stroke="#fff" strokeWidth="8" opacity="0.9" />
          <line x1="0" y1="360" x2="390" y2="370" stroke="#fff" strokeWidth="4" opacity="0.7" />
          <line x1="0" y1="440" x2="390" y2="420" stroke="#fff" strokeWidth="6" opacity="0.8" />
          {/* Vertical roads */}
          <line x1="80"  y1="0" x2="70"  y2="520" stroke="#fff" strokeWidth="4" opacity="0.7" />
          <line x1="160" y1="0" x2="155" y2="520" stroke="#fff" strokeWidth="8" opacity="0.9" />
          <line x1="250" y1="0" x2="260" y2="520" stroke="#fff" strokeWidth="4" opacity="0.7" />
          <line x1="330" y1="0" x2="325" y2="520" stroke="#fff" strokeWidth="6" opacity="0.8" />
          {/* Diagonal roads */}
          <line x1="0"   y1="50"  x2="260" y2="400" stroke="#fff" strokeWidth="4" opacity="0.6" />
          <line x1="100" y1="0"   x2="390" y2="300" stroke="#fff" strokeWidth="5" opacity="0.6" />
          {/* Park block */}
          <rect x="200" y="60" width="130" height="100" fill="#c3dbbf" rx="4" />
          {/* City blocks */}
          <rect x="10"  y="135" width="55" height="55" fill="#d6e8d5" rx="3" />
          <rect x="90"  y="135" width="55" height="55" fill="#d6e8d5" rx="3" />
          <rect x="175" y="230" width="65" height="40" fill="#d6e8d5" rx="3" />
          <rect x="275" y="230" width="50" height="40" fill="#d6e8d5" rx="3" />
          <rect x="10"  y="300" width="50" height="50" fill="#d6e8d5" rx="3" />
          <rect x="85"  y="300" width="60" height="50" fill="#d6e8d5" rx="3" />
          <rect x="275" y="300" width="50" height="110" fill="#d6e8d5" rx="3" />
          <rect x="10"  y="380" width="55" height="30" fill="#d6e8d5" rx="3" />
          <rect x="175" y="380" width="80" height="30" fill="#d6e8d5" rx="3" />
        </svg>

        {/* Nearby driver cars */}
        {NEARBY_DRIVERS.map((d) => (
          <div
            key={d.id}
            style={{
              position: "absolute",
              top: d.top,
              left: d.left,
              transform: `rotate(${d.rotate})`,
              fontSize: 22,
              filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.3))",
              userSelect: "none",
            }}
          >
            🚗
          </div>
        ))}

        {/* Pickup point label — floating above pin */}
        <div
          style={{
            position: "absolute",
            top: "calc(50% - 130px)",
            left: "50%",
            transform: "translateX(-50%)",
            background: "#fff",
            borderRadius: 12,
            padding: "10px 16px",
            display: "flex",
            alignItems: "center",
            gap: 10,
            boxShadow: "0 4px 16px rgba(0,0,0,0.15)",
            minWidth: 240,
            maxWidth: 300,
          }}
        >
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 11, color: "#999", marginBottom: 2 }}>Pickup point</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: "#111", lineHeight: 1.3 }}>
              Av. des Forces Armées Royales
            </div>
          </div>
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: 14,
              background: "#f5f5f5",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <span style={{ fontSize: 14 }}>›</span>
          </div>
          {/* Triangle pointer */}
          <div
            style={{
              position: "absolute",
              bottom: -8,
              left: "50%",
              transform: "translateX(-50%)",
              width: 0,
              height: 0,
              borderLeft: "8px solid transparent",
              borderRight: "8px solid transparent",
              borderTop: "8px solid #fff",
            }}
          />
        </div>

        {/* Center pin */}
        <div
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
          }}
        >
          {/* Outer blue ring */}
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 22,
              background: "rgba(30, 120, 230, 0.15)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "0 0 0 6px rgba(30, 120, 230, 0.08)",
            }}
          >
            {/* Inner blue dot */}
            <div
              style={{
                width: 22,
                height: 22,
                borderRadius: 11,
                background: "#1E78E6",
                border: "3px solid #fff",
                boxShadow: "0 2px 8px rgba(30,120,230,0.5)",
              }}
            />
          </div>
          {/* Green pickup marker below */}
          <div
            style={{
              width: 16,
              height: 16,
              borderRadius: 8,
              background: "#22C55E",
              border: "2.5px solid #fff",
              boxShadow: "0 2px 6px rgba(34,197,94,0.5)",
              marginTop: -4,
            }}
          />
        </div>
      </div>

      {/* ── Top Bar ── */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          paddingTop: 56,
          paddingLeft: 16,
          paddingRight: 16,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          zIndex: 10,
        }}
      >
        {/* Hamburger */}
        <button
          style={{
            width: 44,
            height: 44,
            borderRadius: 22,
            background: "#fff",
            border: "none",
            boxShadow: "0 2px 10px rgba(0,0,0,0.15)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 4,
            cursor: "pointer",
          }}
        >
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              style={{ width: 18, height: 2, background: "#333", borderRadius: 2 }}
            />
          ))}
        </button>
      </div>

      {/* ── Recenter Button ── */}
      <button
        style={{
          position: "absolute",
          bottom: 240,
          right: 16,
          width: 44,
          height: 44,
          borderRadius: 22,
          background: "#fff",
          border: "none",
          boxShadow: "0 2px 10px rgba(0,0,0,0.15)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          zIndex: 10,
          fontSize: 20,
        }}
      >
        ◎
      </button>

      {/* ── Bottom Panel ── */}
      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          background: "#fff",
          borderRadius: "24px 24px 0 0",
          boxShadow: "0 -4px 24px rgba(0,0,0,0.12)",
          zIndex: 20,
          paddingBottom: 28,
        }}
      >
        {/* Handle */}
        <div
          style={{
            width: 36,
            height: 4,
            background: "#E0E0E0",
            borderRadius: 2,
            margin: "10px auto 14px",
          }}
        />

        {/* Vehicle type row */}
        <div
          style={{
            display: "flex",
            overflowX: "auto",
            padding: "0 12px",
            gap: 4,
            marginBottom: 16,
            scrollbarWidth: "none",
          }}
        >
          {VEHICLE_TYPES.map((v) => {
            const active = selected === v.id;
            return (
              <button
                key={v.id}
                onClick={() => setSelected(v.id)}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  padding: "10px 14px 8px",
                  borderRadius: 14,
                  border: "none",
                  background: active ? "#EEF6FF" : "transparent",
                  cursor: "pointer",
                  minWidth: 70,
                  position: "relative",
                  flexShrink: 0,
                }}
              >
                {v.isNew && (
                  <div
                    style={{
                      position: "absolute",
                      top: 4,
                      left: 8,
                      background: "#C5F526",
                      borderRadius: 6,
                      padding: "1px 5px",
                      fontSize: 9,
                      fontWeight: 700,
                      color: "#111",
                    }}
                  >
                    New
                  </div>
                )}
                <span style={{ fontSize: 28, marginBottom: 4, lineHeight: 1 }}>{v.icon}</span>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    color: active ? "#1A73E8" : "#444",
                    lineHeight: 1.2,
                    textAlign: "center",
                    marginBottom: 2,
                  }}
                >
                  {v.label}
                </span>
                {v.count > 0 && (
                  <span
                    style={{
                      fontSize: 10,
                      color: "#999",
                      display: "flex",
                      alignItems: "center",
                      gap: 2,
                    }}
                  >
                    <span style={{ fontSize: 8 }}>👤</span> {v.count}
                  </span>
                )}
              </button>
            );
          })}

          {/* More arrow */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              minWidth: 36,
              paddingRight: 4,
              color: "#999",
              fontSize: 20,
            }}
          >
            ›
          </div>
        </div>

        {/* Search bar */}
        <div style={{ paddingHorizontal: 0, padding: "0 16px" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              background: "#F5F5F5",
              borderRadius: 28,
              padding: "14px 20px",
              cursor: "pointer",
            }}
          >
            <span style={{ fontSize: 18, color: "#555" }}>🔍</span>
            <span
              style={{
                fontSize: 15,
                color: "#666",
                fontWeight: 500,
                letterSpacing: "-0.1px",
              }}
            >
              Where to & for how much?
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
