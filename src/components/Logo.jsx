export default function Logo({ size = 32, withWordmark = true, className = '' }) {
  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      <svg width={size} height={size} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="kxLogoGrad" x1="4" y1="26" x2="28" y2="6" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#D946C6" />
            <stop offset="50%" stopColor="#8B5CF6" />
            <stop offset="100%" stopColor="#00A3FF" />
          </linearGradient>
        </defs>
        <circle cx="16" cy="16" r="15" stroke="url(#kxLogoGrad)" strokeWidth="1.4" opacity="0.5" />
        <path d="M8 20V12L11.5 15.5L16 9L20.5 15.5L24 12V20" stroke="url(#kxLogoGrad)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="8" cy="20" r="1.6" fill="url(#kxLogoGrad)" />
        <circle cx="16" cy="9" r="1.6" fill="url(#kxLogoGrad)" />
        <circle cx="24" cy="20" r="1.6" fill="url(#kxLogoGrad)" />
        <circle cx="11.5" cy="15.5" r="1.2" fill="#09090B" stroke="url(#kxLogoGrad)" strokeWidth="1.1" />
        <circle cx="20.5" cy="15.5" r="1.2" fill="#09090B" stroke="url(#kxLogoGrad)" strokeWidth="1.1" />
      </svg>
      {withWordmark && (
        <span className="font-display font-semibold text-[17px] tracking-tight text-white">
          Kingx<span className="text-gradient">Tech</span>
        </span>
      )}
    </div>
  );
}
