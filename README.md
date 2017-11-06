# Cloudinary Bulk Image Downloader

Downloads all your images from a Cloudinary cloud.

The Cloudinary provided [generate_archive](https://cloudinary.com/documentation/image_upload_api_reference#generate_archive) endpoint has a limitation of 1000 resources or 100MBs.
This tool gets around that by reading from the admin API and downloading images one by one. 

## Install

```
npm i -g cloudinary-bulk-image-downloader
```

## Usage

```
  # cloudinary-bulk-image-downloader --help

  Usage: cloudinary-bulk-image-downloader [options]


  Options:

    -V, --version                        output the version number
    -u, --api-key <api-key>              Cloudinary API key (get from: https://cloudinary.com/console )
    -p, --api-secret <api-secret>        Cloudinary API secret (get from: https://cloudinary.com/console )
    -c, --cloud-name <cloud-name>        Cloudinary cloud name
    -m, --max-result <max-result>        Maximum results to fetch from Cloudinary admin API, default 500
    --max-parallelism <max-parallelism>  Maximum parallel images to download at once, default 5
    --prefix <prefix>                    Cloudinary prefix to filter on (e.g. folder)
    -o --output <output>                 Output folder to download images
    -v, --verbose                        Verbose logging
    -h, --help                           output usage information
```

## Example

Download all images from the cloud:

```
cloudinary-bulk-image-downloader --api-key API_KEY --api-secret API_SECRET --cloud-name demo_cloud --output /tmp/cloudinary_dump
```
