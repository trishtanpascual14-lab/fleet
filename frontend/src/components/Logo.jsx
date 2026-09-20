export function OfficialLogoImage({ className = "h-12" }) {
  return (
    <img 
      src="/trim_logo_user.jpg" 
      alt="TRI-M GLOBAL LOGISTICS & TRADING INC." 
      className={`${className} w-auto object-contain`} 
    />
  );
}

export function OfficialLogoCard({ className = "h-12" }) {
  return (
    <img 
      src="/trim_logo_user.jpg" 
      alt="TRI-M GLOBAL LOGISTICS & TRADING INC." 
      className={`${className} w-auto object-contain rounded-lg`} 
    />
  );
}

export function SidebarLogo({ className = "h-9" }) {
  return (
    <img 
      src="/trim_logo_user.jpg" 
      alt="TRI-M GLOBAL LOGISTICS & TRADING INC." 
      className={`${className} w-auto object-contain rounded-md shrink-0`} 
    />
  );
}
