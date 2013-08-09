#!/bin/env python
SUBDOMAIN = (
    'www',
    'www2',
    'dev',
    'prod',
    'mail',
    'jenkins',
    'cert',
    'apt',
    'haproxy'
)
DOMAIN = (
    'example.com',
    'example.net',
    'example.org'
)

TAGS = (
    'env:prod',
    'role:common-node',
    'role:monitoring',
    'role:frontend',
    'role:worker',
    'availability-zone:us-east-1b',
    'image:ami-d34db33f',
    'instance-type:m1.xlarge',
    'kernel:aki-80888808',
    'security-group:sg-public',
    'security-group:sg-internal'
)

import random

def gen_metrics():
    cpu = random.random()
    return {
        'cpu': cpu,
        'iowait': random.random() * cpu,
        'load_15': random.random() * 2
    }

def row():
    host = '.'.join([random.choice(SUBDOMAIN), random.choice(DOMAIN)])
    aliases = (host + ".ec2.internal", host + ".not.fqdn")
    metrics = gen_metrics()
    tags = random.sample(TAGS, random.randint(0, len(TAGS)))
    return {
        'host': host,
        'aliases': aliases,
        'metrics': metrics,
        'tags': tags,
    }

if __name__ == "__main__":
    import json
    import sys
    [count] = sys.argv[1:]
    print 'Generating {0} rows of sample data'.format(int(count))
    rows = [row() for i in range(0, int(count))]
    with open('tablemutt_test_data.json', 'w') as f:
        f.write(json.dumps(rows, sort_keys=True,
                           indent=4, separators=(',', ': ')))
    with open('tablemutt_test_data.min.json', 'w') as f:
        f.write(json.dumps(rows))
    print 'Done!'