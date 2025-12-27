export function env(name: string): string | undefined {
    const v = process.env[name];
    return v === undefined || v === "" ? undefined : v;
}

export function envBool(name: string): boolean | undefined {
    const v = env(name);
    if (v === undefined) return undefined;
    if (v === "1" || v.toLowerCase() === "true" || v.toLowerCase() === "yes") return true;
    if (v === "0" || v.toLowerCase() === "false" || v.toLowerCase() === "no") return false;
    return undefined;
}

export function envCSV(name: string): string[] | undefined {
    const v = env(name);
    if (v === undefined) return undefined;
    const items = v
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
    return items.length ? items : [];
}


