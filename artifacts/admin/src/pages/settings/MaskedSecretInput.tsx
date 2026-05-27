import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Eye, EyeOff } from "lucide-react";

interface Props {
  id?: string;
  value: string;
  onChange: (v: string) => void;
  hasSaved: boolean;
  placeholder?: string;
}

export function MaskedSecretInput({ id, value, onChange, hasSaved, placeholder }: Props) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input
        id={id}
        type={show ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={
          placeholder ?? (hasSaved ? "•••••••• (leave blank to keep current)" : "")
        }
        className="pr-10"
      />
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setShow((s) => !s)}
        className="absolute right-1 top-1 h-7 w-7 p-0"
        tabIndex={-1}
        aria-label={show ? "Hide value" : "Show value"}
      >
        {show ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
      </Button>
    </div>
  );
}
