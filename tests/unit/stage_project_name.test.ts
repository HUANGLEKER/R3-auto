import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildStageProjectName, fillStageProjectName } from '../../src/platform/stage_project_name.ts';

test('项目名称替换简称或上一部剧名，保留其余词包', () => {
    const suffix = '{剧集ID}{日期}{{h}}{{次新}}{随机数}';
    for (const prefix of ['{剧集简称}', '{{剧集简称}}', '{{旧剧名}}']) {
        const first = buildStageProjectName(prefix + suffix, '八岁鉴真心，寻得良母归');
        assert.equal(first, '{{八岁鉴真心，寻得良母归}}' + suffix);
        assert.equal(buildStageProjectName(first, '第二部剧'), '{{第二部剧}}' + suffix);
    }
    assert.equal(buildStageProjectName('{{旧剧}}尾部', '新$&剧'), '{{新$&剧}}尾部');
    assert.equal(buildStageProjectName('固定标题{剧集简称}', '新剧'), '固定标题{剧集简称}');
    assert.throws(() => buildStageProjectName('{剧集简称}', ''), /剧名为空/);
});

function mockDialog(initial: string, rejectWrite = false) {
    let value = initial;
    const input: any = {
        locator: () => input,
        filter: () => input,
        waitFor: async () => {},
        inputValue: async () => value,
        fill: async (next: string) => { if (!rejectWrite) value = next; },
        blur: async () => {},
    };
    return input;
}

test('项目名称去除剧名中所有中英文感叹号，保留其他词包', () => {
    const suffix = '{剧集ID}{日期}{任务ID}{{h}}{{次新}}{随机数}';
    for (const name of ['大力太子妃她力能扛鼎！', '大力太子妃她力能扛鼎!', '！大力!太子妃她力能扛鼎！！']) {
        assert.equal(buildStageProjectName('{剧集简称}' + suffix, name), '{{大力太子妃她力能扛鼎}}' + suffix);
    }
    assert.equal(buildStageProjectName('{{旧剧！}}' + suffix, '新剧！'), '{{新剧}}' + suffix);
    assert.throws(() => buildStageProjectName('{剧集简称}', ' ！! '), /剧名为空/);
});

test('项目名称去除英文逗号和冒号，保留中文逗号、冒号及其余词包', () => {
    const suffix = '{剧集ID}{日期}{任务ID}{{h}}{{次新}}{随机数}';
    const name = ' ,晚清:逢,新春!！，续篇：归来,: ';
    for (const prefix of ['{剧集简称}', '{{剧集简称}}', '{{旧剧名}}']) {
        assert.equal(buildStageProjectName(prefix + suffix, name), '{{晚清逢新春，续篇：归来}}' + suffix);
    }
    assert.equal(buildStageProjectName('{剧集简称}', '晚清，新春：归来'), '{{晚清，新春：归来}}');
    assert.equal(buildStageProjectName('{剧集简称}', '新 剧'), '{{新 剧}}');
    assert.throws(() => buildStageProjectName('{剧集简称}', ' ,:！! '), /剧名为空/);
    assert.throws(() => buildStageProjectName('{剧集简称}', '新{剧}:,'), /包含花括号/);
});

test('项目名称去除问号、分号、引号、斜杠，保留中文逗号与冒号', () => {
    const suffix = '{剧集ID}{日期}{任务ID}{{h}}{{次新}}{随机数}';
    for (const name of ['“重生八零”：我是首富？', '"重生八零"：我是首富?']) {
        assert.equal(buildStageProjectName('{剧集简称}' + suffix, name), '{{重生八零：我是首富}}' + suffix);
    }
    for (const name of ['重生八零；我是首富;/', '重生八零\\我是首富|']) {
        assert.equal(buildStageProjectName('{剧集简称}' + suffix, name), '{{重生八零我是首富}}' + suffix);
    }
    assert.throws(() => buildStageProjectName('{剧集简称}', ' ?？;；"“”\'‘’/\\| '), /剧名为空/);
});

test('项目名称超过50字符时截断剧名，使总长度刚好50', () => {
    const suffix = '{剧集ID}{日期}{任务ID}{{h}}{{次新}}{随机数}'; // suffix length: 32
    // {{}} adds 4 characters. Suffix is 32. 50 - 36 = 14 characters available for drama name.
    const longName = '我被绝色美女包围了之龙王归来极品神豪逆袭人生'; // length 22
    const result = buildStageProjectName('{剧集简称}' + suffix, longName);
    assert.equal(result.length, 50);
    assert.equal(result, '{{我被绝色美女包围了之龙王归来}}' + suffix);
    assert.equal('我被绝色美女包围了之龙王归来'.length, 14);

    // Continuous replacement with another long name also truncates to exactly 50
    const secondLong = '九天玄尊下山退婚未婚妻竟是绝美千金大小姐'; // length 20
    const secondResult = buildStageProjectName(result, secondLong);
    assert.equal(secondResult.length, 50);
    assert.equal(secondResult, '{{九天玄尊下山退婚未婚妻竟是绝}}' + suffix);

    // If candidate length is <= 50, drama name is not truncated
    const shortName = '八岁鉴真心'; // 5 chars -> total length 4 + 5 + 32 = 41
    const shortResult = buildStageProjectName(result, shortName);
    assert.equal(shortResult.length, 41);
    assert.equal(shortResult, '{{八岁鉴真心}}' + suffix);

    // If candidate length is exactly 50, drama name is not truncated
    const exact14 = '一二三四五六七八九十一二三四'; // 14 chars -> total length 4 + 14 + 32 = 50
    const exactResult = buildStageProjectName('{剧集简称}' + suffix, exact14);
    assert.equal(exactResult.length, 50);
    assert.equal(exactResult, '{{一二三四五六七八九十一二三四}}' + suffix);

    // Truncation happens after cleaning special characters
    const withPunctuation = '我被！绝色美女！包围了之龙王归来极品神豪逆袭人生！';
    const cleanResult = buildStageProjectName('{剧集简称}' + suffix, withPunctuation);
    assert.equal(cleanResult.length, 50);
    assert.equal(cleanResult, '{{我被绝色美女包围了之龙王归来}}' + suffix);

    // Suffix itself too long leaving no room for drama name
    const hugeSuffix = 'a'.repeat(47); // 4 + 47 = 51 > 50, targetLen <= 0
    assert.throws(() => buildStageProjectName('{剧集简称}' + hugeSuffix, '新剧'), /剧名截断后为空/);
});

test('项目名称填写实际值并阻断未生效的修改', async () => {
    const dialog = mockDialog('{剧集简称}{日期}');
    await fillStageProjectName(dialog, '第一部');
    assert.equal(await dialog.inputValue(), '{{第一部}}{日期}');
    await fillStageProjectName(dialog, '第二部');
    assert.equal(await dialog.inputValue(), '{{第二部}}{日期}');
    await fillStageProjectName(dialog, '大力太子妃她力能扛鼎！!');
    assert.equal(await dialog.inputValue(), '{{大力太子妃她力能扛鼎}}{日期}');

    const longDialog = mockDialog('{剧集简称}{剧集ID}{日期}{任务ID}{{h}}{{次新}}{随机数}');
    await fillStageProjectName(longDialog, '我被绝色美女包围了之龙王归来极品神豪逆袭人生');
    assert.equal((await longDialog.inputValue()).length, 50);
    assert.equal(await longDialog.inputValue(), '{{我被绝色美女包围了之龙王归来}}{剧集ID}{日期}{任务ID}{{h}}{{次新}}{随机数}');

    await assert.rejects(fillStageProjectName(mockDialog('{{旧剧}}', true), '新剧'), /值不一致/);
});
