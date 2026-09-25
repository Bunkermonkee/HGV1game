/** Title, level select and briefing screens. */
import { BRAND, brandLogo, type LogoVariant } from '../config/brand.ts';
import type { SaveData } from '../game/storage.ts';
import type { YardLayout } from '../game/yard.ts';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const titleEl = $('title');
const selectEl = $('select');
const briefingEl = $('briefing');
const grid = $('level-grid');

export interface MenuCallbacks {
  onPlay: () => void;
  onPickLevel: (index: number) => void;
  onPickDaily: () => void;
  onStart: () => void;
  onBackToTitle: () => void;
  onLevelSelect: () => void;
  onToggleProView: () => void;
  onToggleSound: () => void;
}

export function initMenus(cb: MenuCallbacks): void {
  $('btn-play').addEventListener('click', cb.onPlay);
  $('btn-daily').addEventListener('click', cb.onPickDaily);
  $('btn-select-back').addEventListener('click', cb.onBackToTitle);
  $('btn-start').addEventListener('click', cb.onStart);
  $('btn-brief-levels').addEventListener('click', cb.onLevelSelect);
  $('pause-levels').addEventListener('click', cb.onLevelSelect);
  $('btn-proview').addEventListener('click', cb.onToggleProView);
  $('pause-proview').addEventListener('click', cb.onToggleProView);
  $('btn-sound').addEventListener('click', cb.onToggleSound);
  $('pause-sound').addEventListener('click', cb.onToggleSound);
  grid.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-index]');
    const daily = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-daily]');
    if (daily) cb.onPickDaily();
    else if (btn && !btn.disabled) cb.onPickLevel(Number(btn.dataset.index));
  });
}

export function setSoundLabel(on: boolean): void {
  for (const id of ['btn-sound', 'pause-sound']) {
    const b = $(id);
    b.textContent = `Sound: ${on ? 'On' : 'Off'}`;
    b.setAttribute('aria-pressed', String(on));
  }
  const t = $('t-sound');
  t.textContent = on ? '🔊' : '🔇';
  t.setAttribute('aria-label', on ? 'Sound on – tap to mute' : 'Sound off – tap to unmute');
  t.setAttribute('aria-pressed', String(on));
}

export function setControlsNote(touch: boolean): void {
  $('controls-note').textContent = touch
    ? 'Drag the wheel to steer · hold FWD or REV to drive · P for the handbrake · ❚❚ to pause'
    : '← → steer · ↑ forward · ↓ reverse · Space handbrake · V mirrors · M sound · Esc pause';
}

export function setProViewLabel(on: boolean): void {
  for (const id of ['btn-proview', 'pause-proview']) {
    const b = $(id);
    b.textContent = `Pro view mirrors: ${on ? 'On' : 'Off'}`;
    b.setAttribute('aria-pressed', String(on));
  }
}

function starsMarkup(n: number): string {
  return [0, 1, 2].map((i) => `<span class="${i < n ? '' : 'off'}">★</span>`).join('');
}

function tagsFor(level: YardLayout): string[] {
  const t: string[] = [];
  if (level.conditions.night) t.push('Night');
  if (level.conditions.rain) t.push('Rain');
  if (level.tutorial.length) t.push('Tutorial');
  return t;
}

/** Fill a logo slot with the real logo, or the "LOGO" placeholder. */
export function showLogo(slot: HTMLElement, variant: LogoVariant): void {
  const src = BRAND.logos[variant];
  slot.replaceChildren();
  slot.classList.toggle('has-logo', !!src);
  if (!src) {
    slot.textContent = 'LOGO';
    return;
  }
  const img = document.createElement('img');
  img.src = brandLogo(variant)?.src ?? src;
  img.alt = BRAND.stationName;
  slot.appendChild(img);
}

export function hideMenus(): void {
  titleEl.classList.add('hidden');
  selectEl.classList.add('hidden');
  briefingEl.classList.add('hidden');
}

export function showTitle(): void {
  hideMenus();
  showLogo($('title-logo'), 'onDark');
  titleEl.classList.remove('hidden');
  $('btn-play').focus();
}

/** Title-screen Daily Yard button text, e.g. "Daily Yard · Thu 25 Sep". */
export function setDailyLabel(text: string): void {
  $('btn-daily').textContent = text;
}

export function showLevelSelect(levels: YardLayout[], save: SaveData, focusIndex = 0, daily?: YardLayout): void {
  hideMenus();
  let total = 0;
  const dailyCard = daily
    ? `<li class="daily-card"><button class="level-btn daily" type="button" data-daily="1"
          aria-label="Daily Yard, ${daily.name.replace('Daily Yard – ', '')}, ${save.levels[daily.id]?.stars ?? 0} of 3 stars">
        <span class="num">Today<span aria-hidden="true">📅</span></span>
        <span class="name">${daily.name}</span>
        <span class="stars" aria-hidden="true">${starsMarkup(save.levels[daily.id]?.stars ?? 0)}</span>
        <ul class="tags"><li class="tag">New every day</li>${tagsFor(daily).map((t) => `<li class="tag">${t}</li>`).join('')}</ul>
      </button></li>`
    : '';
  grid.innerHTML = dailyCard + levels
    .map((l, i) => {
      const rec = save.levels[l.id];
      const stars = rec?.stars ?? 0;
      total += stars;
      const locked = l.number > save.unlocked;
      const tags = tagsFor(l)
        .map((t) => `<li class="tag">${t}</li>`)
        .join('');
      const label = locked ? `Level ${l.number}, ${l.name}, locked` : `Level ${l.number}, ${l.name}, ${stars} of 3 stars`;
      return `<li><button class="level-btn" type="button" data-index="${i}" ${locked ? 'disabled' : ''} aria-label="${label}">
        <span class="num">${l.number}<span aria-hidden="true">${locked ? '🔒' : ''}</span></span>
        <span class="name">${l.name}</span>
        <span class="stars" aria-hidden="true">${starsMarkup(stars)}</span>
        ${tags ? `<ul class="tags">${tags}</ul>` : ''}
      </button></li>`;
    })
    .join('');
  $('select-stars').textContent = `★ ${total} / ${levels.length * 3}`;
  selectEl.classList.remove('hidden');
  const focus = grid.querySelector<HTMLButtonElement>(`button[data-index="${focusIndex}"]:not(:disabled)`);
  (focus ?? grid.querySelector<HTMLButtonElement>('button:not(:disabled)') ?? $('btn-select-back')).focus();
}

function targetText(t: { shunts: number; time: number }): string {
  const sh = t.shunts === 0 ? 'no shunts' : `${t.shunts} shunt${t.shunts === 1 ? '' : 's'} or fewer`;
  return `${sh}, under ${t.time}s`;
}

export function showBriefing(level: YardLayout): void {
  hideMenus();
  $('brief-number').textContent = level.number ? `Level ${level.number}` : 'Daily Yard – same yard for everyone today';
  $('brief-name').textContent = level.name;
  $('brief-text').textContent = level.brief;
  $('brief-tags').innerHTML = tagsFor(level)
    .map((t) => `<li class="tag">${t}</li>`)
    .join('');
  $('brief-three').textContent = `${targetText(level.stars.three)}, no contacts`;
  $('brief-two').textContent = targetText(level.stars.two);
  briefingEl.classList.remove('hidden');
  $('btn-start').focus();
}
