import { ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';
import * as React from 'react';
import { type DayButton, DayPicker, getDefaultClassNames, type Locale } from 'react-day-picker';

import { css, cx } from './_styled';
import { Button, buttonVariants } from './button';

/** Root: defines `--cell-size` / `--cell-radius` consumed by the rules below. */
const calendarRootClass = css`
  --cell-size: 2rem;
  --cell-radius: 0.375rem;
  background-color: var(--background);
  padding: 0.75rem;
`;

const navButtonClass = css`
  width: var(--cell-size);
  height: var(--cell-size);
  padding: 0;
  user-select: none;
  &[aria-disabled='true'] {
    opacity: 0.5;
  }
`;

export function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  captionLayout = 'label',
  buttonVariant = 'ghost',
  locale,
  formatters,
  components,
  ...props
}: React.ComponentProps<typeof DayPicker> & {
  buttonVariant?: React.ComponentProps<typeof Button>['variant'],
}): React.ReactNode {
  const defaults = getDefaultClassNames();

  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cx(calendarRootClass, className)}
      captionLayout={captionLayout}
      locale={locale}
      formatters={{
        formatMonthDropdown: date => date.toLocaleString(locale?.code, { month: 'short' }),
        ...formatters,
      }}
      classNames={{
        root: cx(css`width: fit-content;`, defaults.root),
        months: cx(
          css`
            position: relative;
            display: flex;
            flex-direction: column;
            gap: 1rem;
          `,
          defaults.months,
        ),
        month: cx(
          css`
            display: flex;
            width: 100%;
            flex-direction: column;
            gap: 1rem;
          `,
          defaults.month,
        ),
        nav: cx(
          css`
            position: absolute;
            inset-inline: 0;
            top: 0;
            display: flex;
            width: 100%;
            align-items: center;
            justify-content: space-between;
            gap: 0.25rem;
          `,
          defaults.nav,
        ),
        button_previous: cx(buttonVariants({ variant: buttonVariant }), navButtonClass, defaults.button_previous),
        button_next: cx(buttonVariants({ variant: buttonVariant }), navButtonClass, defaults.button_next),
        month_caption: cx(
          css`
            display: flex;
            height: var(--cell-size);
            width: 100%;
            align-items: center;
            justify-content: center;
            padding: 0 var(--cell-size);
          `,
          defaults.month_caption,
        ),
        caption_label: cx(
          css`
            font-weight: 500;
            user-select: none;
            font-size: 0.875rem;
          `,
          defaults.caption_label,
        ),
        table: css`
          width: 100%;
          border-collapse: collapse;
        `,
        weekdays: cx(css`display: flex;`, defaults.weekdays),
        weekday: cx(
          css`
            flex: 1;
            font-size: 0.8rem;
            font-weight: 400;
            color: var(--muted-foreground);
            user-select: none;
          `,
          defaults.weekday,
        ),
        week: cx(
          css`
            margin-top: 0.5rem;
            display: flex;
            width: 100%;
          `,
          defaults.week,
        ),
        day: cx(
          css`
            position: relative;
            aspect-ratio: 1;
            height: 100%;
            width: 100%;
            border-radius: var(--cell-radius);
            padding: 0;
            text-align: center;
            user-select: none;
          `,
          defaults.day,
        ),
        range_middle: cx(css`border-radius: 0;`, defaults.range_middle),
        today: cx(
          css`
            border-radius: var(--cell-radius);
            background-color: var(--muted);
            color: var(--foreground);
          `,
          defaults.today,
        ),
        outside: cx(css`color: var(--muted-foreground);`, defaults.outside),
        disabled: cx(css`color: var(--muted-foreground); opacity: 0.5;`, defaults.disabled),
        hidden: cx(css`visibility: hidden;`, defaults.hidden),
        ...classNames,
      }}
      components={{
        Root: ({ className: rootClassName, rootRef, ...rootProps }) => (
          <div data-slot="calendar" ref={rootRef} className={rootClassName} {...rootProps} />
        ),
        Chevron: ({ className: chevronClassName, orientation, ...chevronProps }) => {
          if (orientation === 'left') {
            return <ChevronLeftIcon size={16} className={chevronClassName} {...chevronProps} />;
          }
          if (orientation === 'right') {return (
              <ChevronRightIcon size={16} className={chevronClassName} {...chevronProps} />
            );}
          return <ChevronDownIcon size={16} className={chevronClassName} {...chevronProps} />;
        },
        DayButton: dayButtonProps => <CalendarDayButton locale={locale} {...dayButtonProps} />,
        WeekNumber: ({ children, ...weekProps }) => (
          <td {...weekProps}>
            <div
              className={css`
                display: flex;
                width: var(--cell-size);
                height: var(--cell-size);
                align-items: center;
                justify-content: center;
              `}
            >
              {children}
            </div>
          </td>
        ),
        ...components,
      }}
      {...props}
    />
  );
}

const dayButtonClass = css`
  position: relative;
  display: flex;
  aspect-ratio: 1;
  width: 100%;
  min-width: var(--cell-size);
  flex-direction: column;
  gap: 0.25rem;
  border: 0;
  line-height: 1;
  font-weight: 400;
  &[data-selected-single='true'],
  &[data-range-start='true'],
  &[data-range-end='true'] {
    background-color: var(--primary);
    color: var(--primary-foreground);
  }
  &[data-range-middle='true'] {
    background-color: var(--muted);
    color: var(--foreground);
    border-radius: 0;
  }
  & > span {
    font-size: 0.75rem;
    opacity: 0.7;
  }
`;

export function CalendarDayButton({
  className,
  day,
  modifiers,
  locale,
  ...props
}: React.ComponentProps<typeof DayButton> & { locale?: Partial<Locale> }): React.ReactNode {
  const ref = React.useRef<HTMLButtonElement>(null);
  React.useEffect(() => {
    if (modifiers.focused) ref.current?.focus();
  }, [modifiers.focused]);

  return (
    <Button
      ref={ref}
      variant="ghost"
      size="icon"
      data-day={day.date.toLocaleDateString(locale?.code)}
      data-selected-single={modifiers.selected
        && !modifiers.range_start
        && !modifiers.range_end
        && !modifiers.range_middle}
      data-range-start={modifiers.range_start}
      data-range-end={modifiers.range_end}
      data-range-middle={modifiers.range_middle}
      className={cx(dayButtonClass, className)}
      {...props}
    />
  );
}
