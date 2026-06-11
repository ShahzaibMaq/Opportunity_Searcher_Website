import Image from "next/image";

type BrandLogoProps = {
  size?: "sm" | "md";
  showName?: boolean;
};

export function BrandLogo({ size = "md", showName = true }: BrandLogoProps) {
  const imgSize = size === "sm" ? 28 : 32;

  return (
    <div className="flex items-center gap-2">
      <Image
        src="/logo.png"
        alt="Alumni - Aspirations logo"
        width={imgSize}
        height={imgSize}
        className="rounded-md"
        priority
      />
      {showName ? (
        <span className="hidden text-sm font-semibold text-zinc-900 sm:inline">
          Alumni - Aspirations
        </span>
      ) : null}
    </div>
  );
}
