// @vitest-environment jsdom
import { afterEach, describe, it, expect, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import AuthScreen, { type AuthScreenServices } from './AuthScreen';
import type { AuthResult } from '../storage/authService';

afterEach(cleanup);

/** Build fake services; each defaults to a success unless overridden. */
function fakeServices(over: Partial<AuthScreenServices> = {}): AuthScreenServices {
  return {
    signIn: vi.fn(async () => ({ ok: true, userId: 'u-1' }) as AuthResult),
    signUp: vi.fn(async () => ({ ok: true, userId: 'u-2' }) as AuthResult),
    resetPassword: vi.fn(async () => ({ ok: true, userId: null }) as AuthResult),
    ...over,
  };
}

describe('AuthScreen', () => {
  it('signs in and calls onAuthed with the user id', async () => {
    const services = fakeServices();
    const onAuthed = vi.fn();
    render(<AuthScreen onAuthed={onAuthed} onCancel={() => {}} services={services} />);
    fireEvent.change(screen.getByTestId('auth-email'), { target: { value: 'a@b.com' } });
    fireEvent.change(screen.getByTestId('auth-password'), { target: { value: 'pw12345' } });
    fireEvent.click(screen.getByTestId('auth-submit'));
    await waitFor(() => expect(onAuthed).toHaveBeenCalledWith('u-1'));
  });

  it('shows the error message on invalid credentials', async () => {
    const services = fakeServices({
      signIn: vi.fn(async () => ({ ok: false, kind: 'invalidCredentials', message: 'Bad login' }) as AuthResult),
    });
    render(<AuthScreen onAuthed={() => {}} onCancel={() => {}} services={services} />);
    fireEvent.change(screen.getByTestId('auth-email'), { target: { value: 'a@b.com' } });
    fireEvent.change(screen.getByTestId('auth-password'), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByTestId('auth-submit'));
    expect((await screen.findByTestId('auth-error')).textContent).toMatch(/Bad login/);
  });

  it('validates the display name on sign up and blocks submit until valid (20.4)', () => {
    render(<AuthScreen onAuthed={() => {}} onCancel={() => {}} services={fakeServices()} />);
    fireEvent.click(screen.getByTestId('auth-mode-signup'));
    fireEvent.change(screen.getByTestId('auth-email'), { target: { value: 'a@b.com' } });
    fireEvent.change(screen.getByTestId('auth-password'), { target: { value: 'pw12345' } });
    // Bad name (too short) -> shows rule, submit disabled.
    fireEvent.change(screen.getByTestId('auth-displayname'), { target: { value: 'ab' } });
    expect(screen.getByTestId('auth-name-rule')).toBeTruthy();
    expect((screen.getByTestId('auth-submit') as HTMLButtonElement).disabled).toBe(true);
    // Good name -> enabled.
    fireEvent.change(screen.getByTestId('auth-displayname'), { target: { value: 'good_name' } });
    expect((screen.getByTestId('auth-submit') as HTMLButtonElement).disabled).toBe(false);
  });

  it('signs up and calls onAuthed', async () => {
    const services = fakeServices();
    const onAuthed = vi.fn();
    render(<AuthScreen onAuthed={onAuthed} onCancel={() => {}} services={services} />);
    fireEvent.click(screen.getByTestId('auth-mode-signup'));
    fireEvent.change(screen.getByTestId('auth-email'), { target: { value: 'a@b.com' } });
    fireEvent.change(screen.getByTestId('auth-password'), { target: { value: 'pw12345' } });
    fireEvent.change(screen.getByTestId('auth-displayname'), { target: { value: 'good_name' } });
    fireEvent.click(screen.getByTestId('auth-submit'));
    await waitFor(() => expect(onAuthed).toHaveBeenCalledWith('u-2'));
  });

  it('surfaces a displayNameTaken failure message', async () => {
    const services = fakeServices({
      signUp: vi.fn(async () => ({ ok: false, kind: 'displayNameTaken', message: 'Name is taken' }) as AuthResult),
    });
    render(<AuthScreen onAuthed={() => {}} onCancel={() => {}} services={services} />);
    fireEvent.click(screen.getByTestId('auth-mode-signup'));
    fireEvent.change(screen.getByTestId('auth-email'), { target: { value: 'a@b.com' } });
    fireEvent.change(screen.getByTestId('auth-password'), { target: { value: 'pw12345' } });
    fireEvent.change(screen.getByTestId('auth-displayname'), { target: { value: 'good_name' } });
    fireEvent.click(screen.getByTestId('auth-submit'));
    expect((await screen.findByTestId('auth-error')).textContent).toMatch(/taken/i);
  });

  it('forgot-password shows a neutral confirmation and never leaks existence', async () => {
    const resetPassword = vi.fn(async () => ({ ok: true, userId: null }) as AuthResult);
    render(<AuthScreen onAuthed={() => {}} onCancel={() => {}} services={fakeServices({ resetPassword })} />);
    fireEvent.click(screen.getByTestId('auth-mode-forgot'));
    fireEvent.change(screen.getByTestId('auth-email'), { target: { value: 'a@b.com' } });
    fireEvent.click(screen.getByTestId('auth-submit'));
    expect((await screen.findByTestId('auth-notice')).textContent).toMatch(/reset link has been sent/i);
    expect(resetPassword).toHaveBeenCalledWith('a@b.com');
  });

  it('continue-as-guest calls onCancel', () => {
    const onCancel = vi.fn();
    render(<AuthScreen onAuthed={() => {}} onCancel={onCancel} services={fakeServices()} />);
    fireEvent.click(screen.getByTestId('auth-guest'));
    expect(onCancel).toHaveBeenCalled();
  });
});

