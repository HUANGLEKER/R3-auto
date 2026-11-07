export function buildStageProjectName(current: string, dramaName: string): string {
    const prefix = /^(\s*)(?:\{\{[^{}]+\}\}|\{剧集简称\})/;
    const match = current.match(prefix);
    if (!match) {
        return current;
    }
    // The platform rejects ASCII commas/colons, exclamation marks, question marks,
    // semicolons, quotes, and slashes inside the project-name word pack.
    // Chinese commas/colons remain valid.
    let name = dramaName.replace(/[,:!！?？;；"“”'‘’/\\|]/g, '').trim();
    if (!name || /[{}]/.test(name)) {
        throw new Error('搭剧项目名称更新失败：剧名为空或包含花括号');
    }
    const whitespace = match[1];
    const suffix = current.slice(match[0].length);
    const candidateLength = whitespace.length + 4 + name.length + suffix.length;
    if (candidateLength > 50) {
        const excess = candidateLength - 50;
        const targetLen = name.length - excess;
        if (targetLen <= 0) {
            throw new Error('搭剧项目名称更新失败：剧名截断后为空');
        }
        name = name.slice(0, targetLen);
    }
    return `${whitespace}{{${name}}}${suffix}`;
}

export async function fillStageProjectName(dialog: any, dramaName: string): Promise<void> {
    // Keep the label selector relative to the form item. A dialog-rooted
    // locator inside filter({ has }) would search for a nested dialog.
    const input = dialog.locator(
        '.arco-form-item:has(label:text-matches("^\\\\s*项目名称\\\\s*\\\\*?\\\\s*$"))'
    ).locator('textarea, input:not([type="hidden"]):visible');
    await input.waitFor({ state: 'visible', timeout: 10000 });
    const current = await input.inputValue();
    const expected = buildStageProjectName(current, dramaName);
    if (expected === current) {
        return;
    }
    await input.fill(expected);
    await input.blur();
    if (await input.inputValue() !== expected) {
        throw new Error('搭剧“项目名称”填写后值不一致');
    }
    console.log(`   搭剧: 项目名称已更新为 ${expected}`);
}
