
import * as React from "react"

import { cn } from "@/lib/utils"

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, onChange, name, ...props }, ref) => {
    const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
      // --- DEBUGGING START ---
      console.log(`Input-Feld '${name}' geändert. Neuer Wert:`, event.target.value);
      // --- DEBUGGING ENDE ---
      if (onChange) {
        // This ensures that react-hook-form's onChange is called correctly
        onChange(event);
      }
    };
    
    return (
      <input
        type={type}
        className={cn(
          "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          className
        )}
        ref={ref}
        name={name}
        onChange={handleChange}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export { Input }
