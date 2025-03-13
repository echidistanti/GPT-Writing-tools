import os
import cairosvg

def create_icons():
    # Ensure icons directory exists
    if not os.path.exists('icons'):
        os.makedirs('icons')
    
    # Source SVG file
    svg_file = 'icons/icon.svg'
    
    # Icon sizes needed for Chrome extension
    sizes = [16, 48, 128]
    
    for size in sizes:
        output_file = f'icons/icon{size}.png'
        cairosvg.svg2png(
            url=svg_file,
            write_to=output_file,
            output_width=size,
            output_height=size
        )
        print(f"Created {size}x{size} icon: {output_file}")

if __name__ == '__main__':
    create_icons() 