import { Component, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { StudioNavbar } from './studio-navbar';
import { StudioSidebar } from './studio-sidebar';

@Component({
  selector: 'app-studio-layout',
  standalone: true,
  imports: [RouterOutlet, StudioNavbar, StudioSidebar],
  templateUrl: './studio-layout.html',
  styleUrl: './studio-layout.scss',
})
export class StudioLayout {
  protected readonly sidebarOpen = signal(false);

  protected openSidebar(): void {
    this.sidebarOpen.set(true);
  }

  protected closeSidebar(): void {
    this.sidebarOpen.set(false);
  }
}
