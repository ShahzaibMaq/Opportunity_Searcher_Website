type BrandLogoProps = {
  size?: "sm" | "md";
  showName?: boolean;
};

export function BrandLogo({ size = "md", showName = true }: BrandLogoProps) {
  const boxSize = size === "sm" ? "h-7 w-7 text-xs" : "h-8 w-8 text-sm";

  return (
    <div className="flex items-center gap-2">
      <div
        className={`flex ${boxSize} items-center justify-center rounded-md bg-gradient-to-br from-teal-800 to-teal-600 font-semibold text-white shadow-sm`}
        aria-hidden="true"
      >
        AA
      </div>
      {showName ? (
        <span className="hidden text-sm font-semibold text-zinc-900 sm:inline">AlumniAspirations</span>
      ) : null}
    </div>
  );
}
