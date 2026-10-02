import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Window } from 'happy-dom';
import { detectAts, fillForm, labelFor, scanForm, type FormField } from '@/autofill';
import { EMPTY_PROFILE, hasProfile, ProfileSchema, type Profile } from '@/domain/profile';
import { FORM_FIXTURES, loadForm, type FormFixture } from './forms';

const profile: Profile = ProfileSchema.parse({
  firstName: 'Sam',
  lastName: 'Taylor',
  preferredName: 'Sammy',
  email: 'sam@example.com',
  phone: '+61 400 000 000',
  addressLine1: '1 Example Street',
  city: 'Sydney',
  region: 'New South Wales',
  postcode: '2000',
  country: 'Australia',
  linkedin: 'https://linkedin.com/in/sam-example',
  github: 'https://github.com/sam-example',
  website: 'https://sam.example',
  currentCompany: 'Quokka Health',
  currentTitle: 'Analyst',
  workAuthorization: 'yes',
  needsSponsorship: 'no',
  salaryExpectation: '$120k',
  noticePeriod: '4 weeks',
  howHeard: 'LinkedIn',
  answers: [{ question: 'Why do you want to work here?', answer: 'Because of the mission.' }],
});

const FAST = { comboboxWaitMs: 0 };
const shape = (f: FormField) => ({
  label: f.label,
  kind: f.kind,
  key: f.key ?? null,
  sensitive: f.sensitive,
  required: f.required,
});

describe('reading forms (fixtures)', () => {
  it.each(Object.keys(FORM_FIXTURES) as FormFixture[])('%s reads as expected', (name) => {
    const expected = JSON.parse(
      readFileSync(join(__dirname, '../../fixtures/forms', `${name}.expected.json`), 'utf8'),
    ) as { fields: unknown[] };
    expect(scanForm(loadForm(name)).map(shape)).toEqual(expected.fields);
  });

  it('detects the recruiting system', () => {
    expect(detectAts(loadForm('greenhouse/live-2026-10'))).toBe('greenhouse');
    expect(detectAts(loadForm('lever/live-2026-10'))).toBe('lever');
    expect(detectAts(loadForm('ashby/live-2026-10'))).toBe('ashby');
    expect(detectAts(loadForm('workday/my-information'))).toBe('workday');
    expect(detectAts(loadForm('smartrecruiters/one-click'))).toBe('smartrecruiters');
    expect(detectAts(loadForm('generic/careers-page'))).toBeUndefined();
    // White-labelled systems are known by their markup.
    const parse = (html: string) => new DOMParser().parseFromString(html, 'text/html');
    expect(detectAts(parse('<input data-automation-id="legalNameSection_firstName">'))).toBe(
      'workday',
    );
    expect(detectAts(parse('<input name="_systemfield_name">'))).toBe('ashby');
    expect(detectAts(parse('<input name="job_application[first_name]">'))).toBe('greenhouse');
  });
});

describe('fillForm', () => {
  it('fills a company careers form, and leaves what it must', async () => {
    const doc = loadForm('generic/careers-page');
    const events: string[] = [];
    doc.addEventListener('input', (e) => events.push((e.target as HTMLInputElement).name), true);
    const report = await fillForm(doc, profile, FAST);
    const value = (name: string) => doc.querySelector<HTMLInputElement>(`[name="${name}"]`)!.value;

    expect([value('fname'), value('lname'), value('mail'), value('mob')]).toEqual([
      'Sam',
      'Taylor',
      'sam@example.com',
      '+61 400 000 000',
    ]);
    expect([value('st'), value('ctry'), value('pc'), value('address-line')]).toEqual([
      'NSW',
      'AU',
      '2000',
      '1 Example Street',
    ]);
    expect(doc.querySelector<HTMLInputElement>('[name="rtw"][value="1"]')!.checked).toBe(true);
    expect(doc.querySelector<HTMLInputElement>('[name="spons"][value="n"]')!.checked).toBe(true);
    expect([value('sal'), value('np'), value('src'), value('why')]).toEqual([
      '$120k',
      '4 weeks',
      'LinkedIn',
      'Because of the mission.',
    ]);
    // Never overwrites, never answers sensitive questions, never touches secrets.
    expect(value('li')).toBe('https://linkedin.com/in/already-typed');
    expect([value('g'), value('ab'), value('dob'), value('pw'), value('pron')]).toEqual([
      '',
      '',
      '',
      '',
      '',
    ]);
    expect(events).toContain('fname');

    expect(report.filled.map((f) => f.key)).toEqual([
      'firstName',
      'lastName',
      'email',
      'phone',
      'region',
      'country',
      'addressLine1',
      'postcode',
      'workAuthorization',
      'needsSponsorship',
      'salaryExpectation',
      'noticePeriod',
      'howHeard',
      'answer',
    ]);
    expect(report.skipped).toEqual([
      { label: 'How do you pronounce your name?', reason: 'unknown', required: false },
      { label: 'LinkedIn profile URL', reason: 'filled_already', required: false },
      { label: 'Gender', reason: 'sensitive', required: false },
      {
        label: 'Do you identify as Aboriginal or Torres Strait Islander?',
        reason: 'sensitive',
        required: false,
      },
      { label: 'Date of birth', reason: 'sensitive', required: false },
    ]);
    expect(report.files).toEqual(['Upload your resume']);
    expect(doc.querySelector('[name="fname"]')?.hasAttribute('data-rolestash-filled')).toBe(true);
  });

  it('fills Lever: full name, location, links and yes/no questions', async () => {
    const doc = loadForm('lever/live-2026-10');
    const report = await fillForm(doc, profile, FAST);
    const value = (name: string) => doc.querySelector<HTMLInputElement>(`[name="${name}"]`)!.value;
    expect(report.ats).toBe('lever');
    expect(value('name')).toBe('Sam Taylor');
    expect(value('location')).toBe('Sydney, New South Wales, Australia');
    expect(value('org')).toBe('Quokka Health');
    expect(value('urls[GitHub]')).toBe('https://github.com/sam-example');
    expect(report.filled.map((f) => f.key)).toEqual(
      expect.arrayContaining([
        'fullName',
        'email',
        'phone',
        'linkedin',
        'website',
        'preferredName',
        'workAuthorization',
        'needsSponsorship',
      ]),
    );
    expect(report.files).toEqual(['Resume/CV']);
  });

  it('fills Workday and never answers its equal-opportunity questions', async () => {
    const doc = loadForm('workday/my-information');
    const report = await fillForm(doc, profile, FAST);
    expect(report.filled.map((f) => f.key)).toEqual([
      'howHeard',
      'firstName',
      'lastName',
      'addressLine1',
      'city',
      'postcode',
      'email',
      'phone',
    ]);
    expect(report.skipped.filter((s) => s.reason === 'sensitive').map((s) => s.label)).toEqual([
      'Gender',
      'Do you identify as a person with a disability?',
    ]);
  });

  it('leaves type-to-search dropdowns without options untouched (Greenhouse)', async () => {
    const doc = loadForm('greenhouse/live-2026-10');
    const report = await fillForm(doc, profile, FAST);
    expect(report.filled.map((f) => f.key)).toEqual([
      'firstName',
      'lastName',
      'email',
      'phone',
      'linkedin',
      'preferredName',
    ]);
    expect(report.skipped.filter((s) => s.reason === 'no_option').map((s) => s.label)).toContain(
      'Country',
    );
    expect((doc.getElementById('country') as HTMLInputElement).value).toBe('');
  });

  it('picks an option in a type-to-search dropdown', async () => {
    const doc = new DOMParser().parseFromString(
      `<div class="select__container"><label for="c">Country</label>
         <input id="c" aria-autocomplete="list" type="text"><div class="menu"></div></div>`,
      'text/html',
    );
    const input = doc.getElementById('c') as HTMLInputElement;
    const menu = doc.querySelector('.menu')!;
    let chosen = '';
    input.addEventListener('input', () => {
      menu.innerHTML = ['Austria', 'Australia', 'Azerbaijan']
        .filter((c) => c.toLowerCase().startsWith(input.value.slice(0, 2).toLowerCase()))
        .map((c) => `<div role="option">${c}</div>`)
        .join('');
      menu.querySelectorAll('[role="option"]').forEach((o) =>
        o.addEventListener('click', () => {
          chosen = o.textContent;
          menu.innerHTML = `<div class="select__single-value">${chosen}</div>`;
        }),
      );
    });
    const report = await fillForm(doc, profile, FAST);
    expect(chosen).toBe('Australia');
    expect(report.filled).toEqual([{ key: 'country', label: 'Country' }]);
    // Already chosen: left alone.
    expect((await fillForm(doc, profile, FAST)).skipped).toEqual([
      { label: 'Country', reason: 'filled_already', required: false },
    ]);
  });

  it('reports questions the profile has no answer for', async () => {
    const report = await fillForm(loadForm('smartrecruiters/one-click'), EMPTY_PROFILE, FAST);
    expect(report.filled).toEqual([]);
    expect(report.skipped.map((s) => s.reason)).toEqual([
      'no_value',
      'no_value',
      'no_value',
      'no_value',
      'no_value',
      'no_value',
      'no_value',
      'no_value',
      'unknown',
    ]);
  });

  it('never fills fields the user cannot see (transparent, styled hidden, collapsed)', async () => {
    const window = new Window();
    window.document.body.innerHTML = `
      <style>.ghost { visibility: hidden } .clear { opacity: 0 }</style>
      <label for="n">Full name</label><input id="n">
      <div class="ghost"><label for="p">Phone</label><input id="p"></div>
      <div class="clear"><label for="a">Street address</label><input id="a"></div>
      <div style="display:none"><label for="e">Email</label><input id="e"></div>`;
    const doc = window.document as unknown as Document;
    const report = await fillForm(doc, profile, FAST);
    expect(report.filled.map((f) => f.key)).toEqual(['fullName']);
    for (const id of ['p', 'a', 'e'])
      expect((doc.getElementById(id) as HTMLInputElement).value).toBe('');
    await window.happyDOM.close();
  });

  it('skips a select with no matching option', async () => {
    const doc = new DOMParser().parseFromString(
      '<label for="s">How did you hear about us?</label><select id="s"><option value="">Select</option><option>Newspaper</option></select>',
      'text/html',
    );
    expect((await fillForm(doc, profile, FAST)).skipped).toEqual([
      { label: 'How did you hear about us?', reason: 'no_option', required: false },
    ]);
  });
});

describe('labels', () => {
  const doc = (html: string) => new DOMParser().parseFromString(html, 'text/html');

  it('reads aria-labelledby, wrapping labels, containers, placeholders and names', () => {
    const d = doc(`
      <span id="a">Given</span><span id="b">name</span><input id="i1" aria-labelledby="a b">
      <label>Email <input id="i2"></label>
      <div><div class="field-label">Mobile</div><input id="i3"></div>
      <input id="i4" placeholder="Postcode">
      <input id="i5" name="current_company">`);
    const label = (id: string) => labelFor(d.getElementById(id)!);
    expect([label('i1'), label('i2'), label('i3'), label('i4'), label('i5')]).toEqual([
      'Given name',
      'Email',
      'Mobile',
      'Postcode',
      'current company',
    ]);
  });

  it('reads fields inside web components', () => {
    const window = new Window({ url: 'https://example.com/apply' });
    const d = window.document as unknown as Document;
    d.body.innerHTML = '<x-field></x-field>';
    const root = d.querySelector('x-field')!.attachShadow({ mode: 'open' });
    root.innerHTML = '<label for="fn">First name</label><input id="fn">';
    expect(scanForm(d).map((f) => [f.key, f.label])).toEqual([['firstName', 'First name']]);
  });

  it('uses autocomplete and ignores long questions that mention a field', () => {
    const d = doc(`
      <input autocomplete="section-a given-name" aria-label="Your answer">
      <label for="x">Are you bound by any agreement with your current employer that would stop you joining?</label><input id="x">`);
    expect(scanForm(d).map((f) => f.key ?? null)).toEqual(['firstName', null]);
  });
});

describe('profile', () => {
  it('knows when there is something to fill with', () => {
    expect(hasProfile(EMPTY_PROFILE)).toBe(false);
    expect(hasProfile({ ...EMPTY_PROFILE, email: 'a@b.c' })).toBe(true);
    expect(hasProfile({ ...EMPTY_PROFILE, needsSponsorship: 'no' })).toBe(true);
    expect(hasProfile(profile)).toBe(true);
  });
});
