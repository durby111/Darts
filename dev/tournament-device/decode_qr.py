"""Decode rendered pixels with the installed independent libzbar decoder."""
import ctypes as c
from pathlib import Path
from PIL import Image
import sys
p=Path(sys.argv[1]).resolve()
z=c.CDLL('libzbar.so.0')
def bind(name,args,result):
    f=getattr(z,name);f.argtypes=args;f.restype=result;return f
ptr=c.c_void_p
scanner=bind('zbar_image_scanner_create',[],ptr)()
bind('zbar_image_scanner_set_config',[ptr,c.c_int,c.c_int,c.c_int],c.c_int)(scanner,0,0,1)
im=bind('zbar_image_create',[],ptr)()
pixels=Image.open(p/'roster-qr.png').convert('L')
data=c.create_string_buffer(pixels.tobytes())
bind('zbar_image_set_format',[ptr,c.c_ulong],None)(im,int.from_bytes(b'Y800','little'))
bind('zbar_image_set_size',[ptr,c.c_uint,c.c_uint],None)(im,*pixels.size)
bind('zbar_image_set_data',[ptr,ptr,c.c_ulong,ptr],None)(im,data,len(pixels.tobytes()),None)
assert bind('zbar_scan_image',[ptr,ptr],c.c_int)(scanner,im)>0,'No barcode decoded'
symbol=bind('zbar_image_first_symbol',[ptr],ptr)(im)
decoded=bind('zbar_symbol_get_data',[ptr],c.c_char_p)(symbol).decode()
assert decoded==(p/'qr-expected-url.txt').read_text(), 'Decoded QR differs from intended URL'
print('PASS independent libzbar pixel decoding: exact match to intended loopback URL and pairing fragment.')
bind('zbar_image_destroy',[ptr],None)(im)
bind('zbar_image_scanner_destroy',[ptr],None)(scanner)
