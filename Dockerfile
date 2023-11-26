FROM httpd:2-alpine

RUN echo "RedirectMatch ^/$ /build/" | tee -a /usr/local/apache2/conf/httpd.conf

COPY . /usr/local/apache2/htdocs
