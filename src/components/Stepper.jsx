export default function Stepper({ steps, current }) {
  return (
    <div className="flex items-center gap-1.5 mb-8">
      {steps.map((_, i) => (
        <span
          key={i}
          className={`h-1 flex-1 rounded-full transition-colors duration-300 ${
            i < current ? 'bg-kx-gradient' : i === current ? 'bg-white/40' : 'bg-white/10'
          }`}
        />
      ))}
    </div>
  );
}
